import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSourcePhraseIndex, containsIndexedSourcePhrase, validateArtifact, locateMentions } from '../src/lib/artifact'
import { parseEpub } from '../src/lib/epub'
import type { BookId, EpubBlock, ProcessedBookArtifact } from '../src/types'
import { chunkExtractionSchema, type ChunkExtraction } from './extractionSchema'
import { applyArtifactOverrides } from './overrides'
import { runProviderChain, type ProviderName } from './providers'
import { writeQaReport } from './qa'

type CliOptions = {
  bookId: BookId
  provider: ProviderName
  fallback?: ProviderName
  maxChunks?: number
  force: boolean
}

export type ExtractionChunk = {
  index: number
  label: string
  blocks: EpubBlock[]
  hash: string
}

const PROMPT_VERSION = 'forward-only-v1'
const TARGET_TOKENS = 12_000

const parseOptions = (args: string[]): CliOptions => {
  const value = (flag: string) => args[args.indexOf(flag) + 1]
  const bookId = value('--book') as BookId | undefined
  if (!bookId) throw new Error('Usage: pnpm ingest --book <id> [--provider codex] [--fallback claude]')
  const provider = (value('--provider') ?? 'codex') as ProviderName
  const fallback = value('--fallback') as ProviderName | undefined
  const maxChunksRaw = value('--max-chunks')
  return {
    bookId,
    provider,
    fallback,
    maxChunks: maxChunksRaw ? Number(maxChunksRaw) : undefined,
    force: args.includes('--force'),
  }
}

const estimateTokens = (block: EpubBlock) => Math.ceil(block.text.length / 3.6) + 12

export const buildChunks = (chapters: Array<{ title: string; blocks: EpubBlock[] }>): ExtractionChunk[] => {
  const rawChunks: Array<{ label: string; blocks: EpubBlock[] }> = []
  let current: { labels: string[]; blocks: EpubBlock[]; tokens: number } = { labels: [], blocks: [], tokens: 0 }
  const flush = () => {
    if (current.blocks.length > 0) rawChunks.push({ label: current.labels.join(' + '), blocks: current.blocks })
    current = { labels: [], blocks: [], tokens: 0 }
  }

  for (const chapter of chapters) {
    const chapterTokens = chapter.blocks.reduce((sum, block) => sum + estimateTokens(block), 0)
    if (chapterTokens <= TARGET_TOKENS) {
      if (current.tokens + chapterTokens > TARGET_TOKENS) flush()
      current.labels.push(chapter.title)
      current.blocks.push(...chapter.blocks)
      current.tokens += chapterTokens
      continue
    }
    flush()
    let part = 1
    let partBlocks: EpubBlock[] = []
    let partTokens = 0
    for (const block of chapter.blocks) {
      const tokens = estimateTokens(block)
      if (partBlocks.length > 0 && partTokens + tokens > TARGET_TOKENS) {
        rawChunks.push({ label: `${chapter.title} · part ${part}`, blocks: partBlocks })
        part += 1
        partBlocks = []
        partTokens = 0
      }
      partBlocks.push(block)
      partTokens += tokens
    }
    if (partBlocks.length > 0) rawChunks.push({ label: `${chapter.title} · part ${part}`, blocks: partBlocks })
  }
  flush()
  return rawChunks.map((chunk, index) => ({
    ...chunk,
    index,
    hash: createHash('sha256').update(JSON.stringify(chunk.blocks)).digest('hex'),
  }))
}

const compactState = (artifact: ProcessedBookArtifact) => ({
  characters: artifact.entities.map((entity) => ({
    id: entity.id,
    names: artifact.names.filter((record) => record.characterId === entity.id).map((record) => record.name),
    latestSummary: artifact.summaries.filter((record) => record.characterId === entity.id).at(-1)?.summary,
    recentObservations: artifact.observations.filter((record) => record.characterId === entity.id).slice(-4)
      .map((record) => ({ id: record.id, kind: record.kind, summary: record.summary, sourceSequence: record.sourceSequence })),
  })),
  activeRelationships: artifact.relationships.slice(-80),
  knownRecordIds: [...artifact.names, ...artifact.observations, ...artifact.relationships].map((record) => record.id),
})

export const promptFor = (chunk: ExtractionChunk, artifact: ProcessedBookArtifact) => `You extract spoiler-safe character knowledge from fiction into the supplied JSON schema.

HARD SAFETY RULE: You are seeing the story only in canonical forward order. Use only the CURRENT BLOCKS and the PRIOR SAFE STATE below. Never infer, foreshadow, or invent later information. Every output fact must become knowable at its cited source block.

Rules:
- Track meaningful named or titled characters, including non-human characters with agency. Skip nameless crowds and incidental speakers.
- Reuse an existing character id whenever the prior state identifies the same person. New ids must be stable lowercase slugs prefixed with "c-".
- Emit a name fact for each explicit name, alias, surname, or title first established in these blocks. Do not emit pronouns as names.
- Summaries and relationship details must be concise paraphrases, never quotations from the source.
- Each observation must be atomic, supported by its evidenceBlockIds, and cite the block where it becomes knowable.
- Relationship events are directional but should describe a reader-known connection. Use starts, updates, or ends.
- Emit an end-of-chunk summary snapshot for every character whose reader-known state materially changes. Set the snapshot source to the final CURRENT BLOCK and list only prior/output record ids actually used.
- Use deterministic ids such as name-<character>-<sequence>, obs-<character>-<sequence>-<kind>, rel-<from>-<to>-<sequence>, and summary-<character>-<sequence>.
- Return only data matching the JSON schema.

PRIOR SAFE STATE:
${JSON.stringify(compactState(artifact))}

CURRENT BLOCKS (${chunk.label}, sequences ${chunk.blocks[0].sourceSequence}-${chunk.blocks.at(-1)!.sourceSequence}):
${JSON.stringify(chunk.blocks.map((block) => ({ id: block.id, sourceSequence: block.sourceSequence, chapterId: block.chapterId, text: block.text })))}`

const emptyArtifact = (bookId: BookId, fingerprint: string, sourceBlockCount: number): ProcessedBookArtifact => ({
  schemaVersion: 1,
  promptVersion: PROMPT_VERSION,
  bookId,
  fingerprint,
  generatedAt: '1970-01-01T00:00:00.000Z',
  sourceBlockCount,
  entities: [],
  names: [],
  mentions: [],
  observations: [],
  relationships: [],
  summaries: [],
})

const mergeExtraction = (artifact: ProcessedBookArtifact, extraction: ChunkExtraction): ProcessedBookArtifact => ({
  ...artifact,
  entities: [...new Map([...artifact.entities, ...extraction.entities].map((record) => [record.id, record])).values()],
  names: [...artifact.names, ...extraction.names],
  observations: [...artifact.observations, ...extraction.observations],
  relationships: [...artifact.relationships, ...extraction.relationships],
  summaries: [...artifact.summaries, ...extraction.summaries],
})

const validateChunk = (chunk: ExtractionChunk, artifact: ProcessedBookArtifact, extraction: ChunkExtraction) => {
  const parsed = chunkExtractionSchema.parse(extraction)
  const blockIds = new Set(chunk.blocks.map((block) => block.id))
  const sequenceByBlock = new Map(chunk.blocks.map((block) => [block.id, block.sourceSequence]))
  const entityIds = new Set([...artifact.entities, ...parsed.entities].map((entity) => entity.id))
  const records = [...parsed.names, ...parsed.observations, ...parsed.relationships, ...parsed.summaries]
  for (const record of records) {
    if (!blockIds.has(record.sourceBlockId)) throw new Error(`${record.id} cites a block outside the current forward-only chunk.`)
    if (sequenceByBlock.get(record.sourceBlockId) !== record.sourceSequence) throw new Error(`${record.id} has a mismatched source sequence.`)
  }
  for (const record of [...parsed.names, ...parsed.observations, ...parsed.summaries]) {
    if (!entityIds.has(record.characterId)) throw new Error(`${record.id} references an unknown character.`)
  }
  for (const observation of parsed.observations) {
    for (const evidenceBlockId of observation.evidenceBlockIds) {
      if (!blockIds.has(evidenceBlockId)) throw new Error(`${observation.id} cites evidence outside the current forward-only chunk.`)
      const evidenceSequence = sequenceByBlock.get(evidenceBlockId) ?? Number.POSITIVE_INFINITY
      if (evidenceSequence > observation.sourceSequence) {
        observation.sourceSequence = evidenceSequence
        observation.sourceBlockId = evidenceBlockId
      }
    }
  }
  const inputRecords = new Map(
    [...artifact.names, ...artifact.observations, ...artifact.relationships, ...parsed.names, ...parsed.observations, ...parsed.relationships]
      .map((record) => [record.id, record] as const),
  )
  for (const summary of parsed.summaries) {
    for (const inputRecordId of summary.inputRecordIds) {
      const input = inputRecords.get(inputRecordId)
      if (input && input.sourceSequence > summary.sourceSequence) {
        summary.sourceSequence = input.sourceSequence
        summary.sourceBlockId = input.sourceBlockId
      }
    }
  }
  const blockTextById = new Map(chunk.blocks.map((block) => [block.id, block.text]))
  const chunkPhraseIndex = buildSourcePhraseIndex(chunk.blocks.map((block) => block.text))
  for (const observation of parsed.observations) {
    if (containsIndexedSourcePhrase(observation.summary, chunkPhraseIndex)) {
      throw new Error(`${observation.id} contains a long verbatim source phrase.`)
    }
  }
  for (const record of [...parsed.relationships, ...parsed.summaries]) {
    const source = blockTextById.get(record.sourceBlockId)
    const derived = 'detail' in record ? record.detail : record.summary
    if (source && containsIndexedSourcePhrase(derived, chunkPhraseIndex)) {
      throw new Error(`${record.id} contains a long verbatim source phrase.`)
    }
  }
  for (const record of parsed.relationships) {
    if (!entityIds.has(record.fromCharacterId) || !entityIds.has(record.toCharacterId)) {
      throw new Error(`${record.id} references an unknown relationship endpoint.`)
    }
  }
  return parsed
}

export const restoreCheckpoint = (
  value: unknown,
  chunk: ExtractionChunk,
  artifact: ProcessedBookArtifact,
) => {
  if (!value || typeof value !== 'object') return undefined
  const checkpoint = value as { promptVersion?: unknown; chunkHash?: unknown; extraction?: unknown }
  if (checkpoint.promptVersion !== PROMPT_VERSION || checkpoint.chunkHash !== chunk.hash) return undefined
  return validateChunk(chunk, artifact, chunkExtractionSchema.parse(checkpoint.extraction))
}

const runWithRetryAndFallback = async (
  options: CliOptions,
  chunk: ExtractionChunk,
  prompt: string,
  artifact: ProcessedBookArtifact,
) => {
  const providers = [options.provider, ...(options.fallback && options.fallback !== options.provider ? [options.fallback] : [])]
  try {
    const result = await runProviderChain(
      providers,
      prompt,
      (extraction) => validateChunk(chunk, artifact, extraction),
      undefined,
      (provider, attempt) => process.stdout.write(`  ${provider} attempt ${attempt}…\n`),
    )
    return { provider: result.provider, extraction: result.value }
  } catch (error) {
    throw new Error(`All extraction providers failed for ${chunk.label}:\n${error instanceof Error ? error.message : String(error)}`)
  }
}

const readOverrides = async (bookId: BookId) => {
  try {
    return JSON.parse(await readFile(resolve(`pipeline/overrides/${bookId}.json`), 'utf8')) as unknown
  } catch {
    return {}
  }
}

export async function ingest(options: CliOptions) {
  const root = resolve('.')
  const epubPath = join(root, 'public', 'books', `${options.bookId}.epub`)
  const workDirectory = join(root, '.highlighter-work', options.bookId)
  const checkpointDirectory = join(workDirectory, 'chunks')
  const outputPath = join(root, 'src', 'data', 'artifacts', `${options.bookId}.json`)
  await mkdir(checkpointDirectory, { recursive: true })
  await mkdir(join(root, 'src', 'data', 'artifacts'), { recursive: true })

  const book = await parseEpub(await readFile(epubPath))
  const chunks = buildChunks(book.chapters)
  const selectedChunks = options.maxChunks ? chunks.slice(0, options.maxChunks) : chunks
  let artifact = emptyArtifact(options.bookId, book.fingerprint, book.maxSequence)
  process.stdout.write(`${book.metadata.title}: ${book.chapters.length} chapters, ${book.maxSequence} blocks, ${chunks.length} extraction chunks.\n`)

  for (const chunk of selectedChunks) {
    const checkpointPath = join(checkpointDirectory, `${String(chunk.index + 1).padStart(3, '0')}.json`)
    let extraction: ChunkExtraction | undefined
    if (!options.force) {
      try {
        extraction = restoreCheckpoint(JSON.parse(await readFile(checkpointPath, 'utf8')), chunk, artifact)
      } catch {
        extraction = undefined
      }
    }
    if (extraction) {
      process.stdout.write(`[${chunk.index + 1}/${selectedChunks.length}] ${chunk.label}: checkpoint\n`)
    } else {
      process.stdout.write(`[${chunk.index + 1}/${selectedChunks.length}] ${chunk.label}: extracting\n`)
      const result = await runWithRetryAndFallback(options, chunk, promptFor(chunk, artifact), artifact)
      extraction = result.extraction
      await writeFile(checkpointPath, `${JSON.stringify({
        promptVersion: PROMPT_VERSION,
        chunkHash: chunk.hash,
        provider: result.provider,
        extractedAt: new Date().toISOString(),
        extraction,
      }, null, 2)}\n`)
    }
    artifact = mergeExtraction(artifact, extraction)
  }

  artifact.generatedAt = '1970-01-01T00:00:00.000Z'
  artifact.mentions = locateMentions(book, artifact)
  artifact = applyArtifactOverrides(artifact, await readOverrides(options.bookId))
  const validation = validateArtifact(artifact, options.maxChunks ? undefined : book)
  await writeQaReport(join(workDirectory, 'qa.html'), book, artifact, validation.issues)
  if (validation.issues.length > 0) {
    throw new Error(`Artifact validation failed. Review ${join(workDirectory, 'qa.html')}:\n${validation.issues.join('\n')}`)
  }
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`)
  process.stdout.write(`Wrote ${outputPath}\nQA report: ${join(workDirectory, 'qa.html')}\n`)
  return artifact
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntryPoint) {
  ingest(parseOptions(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
