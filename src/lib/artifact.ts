import { z } from 'zod'
import type {
  CharacterMention,
  ParsedEpub,
  ProcessedBookArtifact,
  RelationshipEvent,
} from '../types'

const sourcedRecordSchema = z.object({
  sourceSequence: z.number().int().positive(),
  sourceBlockId: z.string().min(1),
})

const characterEntitySchema = z.object({ id: z.string().min(1) })

const nameFactSchema = sourcedRecordSchema.extend({
  id: z.string().min(1),
  characterId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['name', 'alias', 'title']),
})

const mentionSchema = sourcedRecordSchema.extend({
  id: z.string().min(1),
  characterId: z.string().min(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
})

const observationSchema = sourcedRecordSchema.extend({
  id: z.string().min(1),
  characterId: z.string().min(1),
  kind: z.enum(['Introduction', 'Attribute', 'Action', 'Relationship', 'Location', 'Goal', 'Revelation', 'Status']),
  summary: z.string().min(1),
  evidenceBlockIds: z.array(z.string().min(1)).min(1),
})

const relationshipSchema = sourcedRecordSchema.extend({
  id: z.string().min(1),
  fromCharacterId: z.string().min(1),
  toCharacterId: z.string().min(1),
  label: z.string().min(1),
  detail: z.string().min(1),
  state: z.enum(['starts', 'updates', 'ends']),
})

const summarySchema = sourcedRecordSchema.extend({
  id: z.string().min(1),
  characterId: z.string().min(1),
  summary: z.string().min(1),
  inputRecordIds: z.array(z.string().min(1)),
})

export const processedBookArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  promptVersion: z.string().min(1),
  bookId: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().min(1),
  sourceBlockCount: z.number().int().positive(),
  entities: z.array(characterEntitySchema),
  names: z.array(nameFactSchema),
  mentions: z.array(mentionSchema),
  observations: z.array(observationSchema),
  relationships: z.array(relationshipSchema),
  summaries: z.array(summarySchema),
})

export type ArtifactValidation = {
  artifact?: ProcessedBookArtifact
  issues: string[]
}

const duplicateIds = (records: Array<{ id: string }>) => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const record of records) {
    if (seen.has(record.id)) duplicates.add(record.id)
    seen.add(record.id)
  }
  return [...duplicates]
}

const normalizedWords = (value: string) => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
const normalizedNameSurface = (value: string) => value.toLocaleLowerCase().replace(/’/g, "'")

export const buildSourcePhraseIndex = (sources: string[], minimumWords = 10) => {
  const phrases = new Set<string>()
  for (const source of sources) {
    const words = normalizedWords(source)
    for (let index = 0; index <= words.length - minimumWords; index += 1) {
      phrases.add(words.slice(index, index + minimumWords).join(' '))
    }
  }
  return phrases
}

export const containsIndexedSourcePhrase = (derived: string, phrases: Set<string>, minimumWords = 10) => {
  const derivedWords = normalizedWords(derived)
  if (derivedWords.length < minimumWords) return false
  for (let index = 0; index <= derivedWords.length - minimumWords; index += 1) {
    if (phrases.has(derivedWords.slice(index, index + minimumWords).join(' '))) return true
  }
  return false
}

export const containsLongSourcePhrase = (derived: string, sources: string[], minimumWords = 10) =>
  containsIndexedSourcePhrase(derived, buildSourcePhraseIndex(sources, minimumWords), minimumWords)

export function validateArtifact(value: unknown, book?: ParsedEpub): ArtifactValidation {
  const parsed = processedBookArtifactSchema.safeParse(value)
  if (!parsed.success) {
    return { issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }
  }

  const artifact = parsed.data as ProcessedBookArtifact
  const issues: string[] = []
  const entityIds = new Set(artifact.entities.map((entity) => entity.id))
  const blockMap = new Map(book?.blocks.map((block) => [block.id, block]))
  const bookPhraseIndex = buildSourcePhraseIndex(book?.blocks.map((block) => block.text) ?? [])
  const recordIds = new Map<string, number>()
  const recordGroups = [artifact.names, artifact.observations, artifact.relationships]

  for (const record of recordGroups.flat()) recordIds.set(record.id, record.sourceSequence)
  for (const id of duplicateIds(artifact.entities)) issues.push(`Duplicate character entity: ${id}`)
  for (const id of duplicateIds([
    ...artifact.names,
    ...artifact.mentions,
    ...artifact.observations,
    ...artifact.relationships,
    ...artifact.summaries,
  ])) issues.push(`Duplicate sourced record: ${id}`)

  const sourcedRecords = [
    ...artifact.names,
    ...artifact.mentions,
    ...artifact.observations,
    ...artifact.relationships,
    ...artifact.summaries,
  ]
  for (const record of sourcedRecords) {
    if (record.sourceSequence > artifact.sourceBlockCount) {
      issues.push(`${record.id} is beyond sourceBlockCount.`)
    }
    if (book) {
      const block = blockMap.get(record.sourceBlockId)
      if (!block) issues.push(`${record.id} references missing block ${record.sourceBlockId}.`)
      else if (block.sourceSequence !== record.sourceSequence) {
        issues.push(`${record.id} sourceSequence does not match ${record.sourceBlockId}.`)
      }
    }
  }

  for (const record of [...artifact.names, ...artifact.mentions, ...artifact.observations, ...artifact.summaries]) {
    if (!entityIds.has(record.characterId)) issues.push(`${record.id} references unknown character ${record.characterId}.`)
  }
  for (const relationship of artifact.relationships) {
    if (!entityIds.has(relationship.fromCharacterId)) issues.push(`${relationship.id} has an unknown source character.`)
    if (!entityIds.has(relationship.toCharacterId)) issues.push(`${relationship.id} has an unknown target character.`)
    if (relationship.fromCharacterId === relationship.toCharacterId) issues.push(`${relationship.id} is a self-relationship.`)
  }

  if (book) {
    for (const observation of artifact.observations) {
      for (const evidenceBlockId of observation.evidenceBlockIds) {
        const evidence = blockMap.get(evidenceBlockId)
        if (!evidence) issues.push(`${observation.id} references missing evidence block ${evidenceBlockId}.`)
        else if (evidence.sourceSequence > observation.sourceSequence) {
          issues.push(`${observation.id} depends on future evidence ${evidenceBlockId}.`)
        }
      }
      if (containsIndexedSourcePhrase(observation.summary, bookPhraseIndex)) {
        issues.push(`${observation.id} contains a long verbatim source phrase.`)
      }
    }
    for (const record of [...artifact.relationships, ...artifact.summaries]) {
      const source = blockMap.get(record.sourceBlockId)
      const derived = 'detail' in record ? record.detail : record.summary
      if (source && containsIndexedSourcePhrase(derived, bookPhraseIndex)) {
        issues.push(`${record.id} contains a long verbatim source phrase.`)
      }
    }
  }

  if (book) {
    if (artifact.fingerprint !== book.fingerprint) issues.push('Artifact fingerprint does not match the EPUB.')
    if (artifact.sourceBlockCount !== book.maxSequence) issues.push('Artifact block count does not match the EPUB.')
    for (const mention of artifact.mentions) {
      const block = blockMap.get(mention.sourceBlockId)
      if (!block) continue
      if (mention.endOffset <= mention.startOffset || mention.endOffset > block.text.length) {
        issues.push(`${mention.id} has invalid text offsets.`)
        continue
      }
      const mentionText = normalizedNameSurface(block.text.slice(mention.startOffset, mention.endOffset))
      const eligibleOwners = new Set(artifact.names
        .filter((fact) => fact.sourceSequence <= mention.sourceSequence && normalizedNameSurface(fact.name) === mentionText)
        .map((fact) => fact.characterId))
      const supported = eligibleOwners.size === 1 && eligibleOwners.has(mention.characterId)
      if (!supported) {
        issues.push(`${mention.id} is not supported by one unambiguous eligible name fact.`)
      }
    }
  }

  for (const snapshot of artifact.summaries) {
    for (const inputId of snapshot.inputRecordIds) {
      const inputSequence = recordIds.get(inputId)
      if (inputSequence === undefined) issues.push(`${snapshot.id} references missing input ${inputId}.`)
      else if (inputSequence > snapshot.sourceSequence) issues.push(`${snapshot.id} depends on future input ${inputId}.`)
    }
  }

  return { artifact, issues }
}

export function assertValidArtifact(value: unknown, book?: ParsedEpub) {
  const result = validateArtifact(value, book)
  if (!result.artifact || result.issues.length > 0) {
    throw new Error(`Processed artifact is invalid:\n${result.issues.join('\n')}`)
  }
  return result.artifact
}

export function locateMentions(
  book: ParsedEpub,
  artifact: Pick<ProcessedBookArtifact, 'names'>,
): CharacterMention[] {
  const earliestFacts = new Map<string, ProcessedBookArtifact['names'][number]>()
  for (const fact of artifact.names) {
    const key = `${fact.characterId}::${normalizedNameSurface(fact.name)}`
    const current = earliestFacts.get(key)
    if (!current || fact.sourceSequence < current.sourceSequence) earliestFacts.set(key, fact)
  }
  const names = [...earliestFacts.values()].sort((a, b) => b.name.length - a.name.length)
  const output: CharacterMention[] = []

  for (const block of book.blocks) {
    const occupied: Array<[number, number]> = []
    const eligibleOwners = new Map<string, Set<string>>()
    for (const fact of names) {
      if (fact.sourceSequence > block.sourceSequence) continue
      const key = normalizedNameSurface(fact.name)
      const owners = eligibleOwners.get(key) ?? new Set<string>()
      owners.add(fact.characterId)
      eligibleOwners.set(key, owners)
    }
    for (const fact of names) {
      if (fact.sourceSequence > block.sourceSequence) continue
      if (eligibleOwners.get(normalizedNameSurface(fact.name))?.size !== 1) continue
      const escaped = fact.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const apostropheFlexible = escaped.replace(/['’]/g, "['’]")
      const matcher = new RegExp(`(?<![\\p{L}\\p{N}])${apostropheFlexible}(?![\\p{L}\\p{N}])`, 'giu')
      for (const match of block.text.matchAll(matcher)) {
        const startOffset = match.index
        const endOffset = startOffset + match[0].length
        if (occupied.some(([start, end]) => startOffset < end && endOffset > start)) continue
        occupied.push([startOffset, endOffset])
        output.push({
          id: `mention-${block.id}-${startOffset}-${fact.characterId}`,
          characterId: fact.characterId,
          sourceSequence: block.sourceSequence,
          sourceBlockId: block.id,
          startOffset,
          endOffset,
        })
      }
    }
  }
  return output.sort((a, b) => a.sourceSequence - b.sourceSequence || a.startOffset - b.startOffset)
}

export function activeRelationships(records: RelationshipEvent[]) {
  const active = new Map<string, RelationshipEvent>()
  for (const record of [...records].sort((a, b) => a.sourceSequence - b.sourceSequence)) {
    const pair = [record.fromCharacterId, record.toCharacterId].sort().join('::')
    if (record.state === 'ends') active.delete(pair)
    else active.set(pair, record)
  }
  return [...active.values()]
}
