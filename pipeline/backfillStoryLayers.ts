import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  NameFact,
  Observation,
  ProcessedBookArtifact,
  StorySentence,
  SummarySnapshot,
} from '../src/types'

type LegacyArtifact = Omit<ProcessedBookArtifact, 'schemaVersion' | 'storySentences'> & {
  schemaVersion: 1 | 2
  storySentences?: StorySentence[]
}

const kindWeight: Record<Observation['kind'], number> = {
  Introduction: 8,
  Revelation: 8,
  Attribute: 7,
  Goal: 7,
  Status: 6,
  Relationship: 6,
  Action: 4,
  Location: 3,
}

const durableFactPattern = /\b(?:unable|former(?:ly)?|best|damage|injur|cure|identity|reveals?|kill|dies?|death|father|mother|daughter|son|created?|creator|self-destruction)\b/iu
const sentenceWords = (value: string) => value.trim().split(/\s+/u).filter(Boolean)
const withoutTerminalPunctuation = (value: string) => value.trim().replace(/[.!?]+$/u, '')

const displayNameAt = (names: NameFact[], characterId: string, sourceSequence: number) => {
  const eligible = names
    .filter((record) => record.characterId === characterId && record.sourceSequence <= sourceSequence)
    .sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id))
  return [...eligible].reverse().find((record) => record.kind === 'name')?.name
    ?? eligible.at(-1)?.name
    ?? characterId
}

const importanceFor = (observations: Observation[]): StorySentence['importance'] => {
  if (observations.some((record) =>
    record.kind === 'Introduction'
    || record.kind === 'Revelation'
    || durableFactPattern.test(record.summary))) return 'major'
  if (observations.some((record) => ['Goal', 'Status', 'Relationship', 'Action'].includes(record.kind))) return 'supporting'
  return 'minor'
}

const joinObservationBeat = (observations: Observation[]) => {
  const ranked = observations
    .map((record, index) => ({ record, index, weight: kindWeight[record.kind] + (durableFactPattern.test(record.summary) ? 2 : 0) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
  const selected: typeof ranked = []
  let words = 0
  for (const candidate of ranked) {
    const count = sentenceWords(candidate.record.summary).length
    if (selected.length > 0 && words + count > 32) continue
    selected.push(candidate)
    words += count
    if (words >= 26) break
  }
  const ordered = selected.sort((a, b) => a.index - b.index).map(({ record }) => withoutTerminalPunctuation(record.summary))
  return `${ordered.map((part, index) => index === 0
    ? part
    : part.replace(/^(He|She|They|It)\b/u, (pronoun) => pronoun.toLocaleLowerCase()))
    .join('; ')}.`
}

export const buildStorySentences = (observations: Observation[]): StorySentence[] => {
  const beats = new Map<string, Observation[]>()
  for (const observation of observations) {
    const key = `${observation.characterId}::${observation.sourceSequence}`
    const records = beats.get(key) ?? []
    records.push(observation)
    beats.set(key, records)
  }
  return [...beats.values()]
    .map((records) => {
      const ordered = [...records].sort((a, b) => a.id.localeCompare(b.id))
      const source = ordered[0]
      return {
        id: `story-${source.characterId}-${source.sourceSequence}`,
        characterId: source.characterId,
        sentence: joinObservationBeat(ordered),
        inputRecordIds: ordered.map((record) => record.id),
        importance: importanceFor(ordered),
        sourceSequence: source.sourceSequence,
        sourceBlockId: source.sourceBlockId,
      }
    })
    .sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id))
}

const overviewScore = (observation: Observation, index: number, total: number) => {
  const recency = total <= 1 ? 0 : Math.round((index / (total - 1)) * 2)
  return kindWeight[observation.kind] + recency + (durableFactPattern.test(observation.summary) ? 3 : 0)
}

const nameTheFirstSentence = (summary: string, displayName: string) => summary
  .replace(/^(He|She|They|It)\b/u, displayName)
  .replace(/^([^,]{1,80}), (he|she|they|it)\b/u, `$1, ${displayName}`)

export const buildBoundedOverview = (
  observations: Observation[],
  displayName: string,
  wordBudget = 80,
) => {
  const ranked = observations
    .map((record, index) => ({ record, index, score: overviewScore(record, index, observations.length) }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
  const chosen: typeof ranked = []
  let words = 0
  for (const candidate of ranked) {
    const count = sentenceWords(candidate.record.summary).length
    if (chosen.length > 0 && words + count > wordBudget) continue
    chosen.push(candidate)
    words += count
  }
  const chronological = chosen.sort((a, b) => a.index - b.index)
  const summary = chronological
    .map(({ record }, index) => index === 0 ? nameTheFirstSentence(record.summary, displayName) : record.summary)
    .join(' ')
  return {
    summary,
    inputRecordIds: chronological.map(({ record }) => record.id),
  }
}

export const backfillStoryLayers = (legacy: LegacyArtifact): ProcessedBookArtifact => {
  const storySentences = buildStorySentences(legacy.observations)
  const summaries = legacy.summaries.filter((record) => !record.id.startsWith('summary-backfill-'))
  for (const entity of legacy.entities) {
    const observations = legacy.observations
      .filter((record) => record.characterId === entity.id)
      .sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id))
    const firstExistingSequence = summaries
      .filter((record) => record.characterId === entity.id)
      .reduce((minimum, record) => Math.min(minimum, record.sourceSequence), Number.POSITIVE_INFINITY)
    const established: Observation[] = []
    let lastGeneratedSummary: string | undefined
    for (const observation of observations) {
      established.push(observation)
      const next = observations[established.length]
      if (next?.sourceSequence === observation.sourceSequence) continue
      if (observation.sourceSequence >= firstExistingSequence) break
      const overview = buildBoundedOverview(
        established,
        displayNameAt(legacy.names, entity.id, observation.sourceSequence),
      )
      if (overview.summary === lastGeneratedSummary) continue
      lastGeneratedSummary = overview.summary
      const snapshot: SummarySnapshot = {
        id: `summary-backfill-${entity.id}-${observation.sourceSequence}`,
        characterId: entity.id,
        summary: overview.summary,
        inputRecordIds: overview.inputRecordIds,
        sourceSequence: observation.sourceSequence,
        sourceBlockId: observation.sourceBlockId,
      }
      summaries.push(snapshot)
    }
  }

  return {
    ...legacy,
    schemaVersion: 2,
    promptVersion: legacy.promptVersion.includes('story-layers-v2')
      ? legacy.promptVersion
      : `${legacy.promptVersion}+story-layers-v2`,
    summaries: summaries.sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id)),
    storySentences,
  }
}

const run = async () => {
  for (const bookId of ['alice', 'frankenstein', 'neuromancer']) {
    const path = resolve(`src/data/artifacts/${bookId}.json`)
    const artifact = JSON.parse(await readFile(path, 'utf8')) as LegacyArtifact
    const upgraded = backfillStoryLayers(artifact)
    await writeFile(path, `${JSON.stringify(upgraded, null, 2)}\n`)
    process.stdout.write(`${bookId}: ${upgraded.storySentences.length} story beats, ${upgraded.summaries.length} snapshots\n`)
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntryPoint) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
