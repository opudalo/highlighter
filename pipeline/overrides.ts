import { z } from 'zod'
import type { ProcessedBookArtifact } from '../src/types'

export const artifactOverrideSchema = z.object({
  suppressIds: z.array(z.string()).default([]),
  mergeCharacters: z.array(z.object({ from: z.string(), into: z.string() })).default([]),
  names: z.array(z.any()).default([]),
  observations: z.array(z.any()).default([]),
  relationships: z.array(z.any()).default([]),
  summaries: z.array(z.any()).default([]),
  storySentences: z.array(z.any()).default([]),
})

export type ArtifactOverride = z.infer<typeof artifactOverrideSchema>

const replaceOrAppend = <T extends { id: string }>(records: T[], replacements: T[]) => {
  const byId = new Map(records.map((record) => [record.id, record]))
  replacements.forEach((record) => byId.set(record.id, record))
  return [...byId.values()]
}

export function applyArtifactOverrides(
  artifact: ProcessedBookArtifact,
  value: unknown,
): ProcessedBookArtifact {
  const overrides = artifactOverrideSchema.parse(value)
  const suppressed = new Set(overrides.suppressIds)
  const merges = new Map(overrides.mergeCharacters.map((merge) => [merge.from, merge.into]))
  const characterId = (id: string): string => merges.has(id) ? characterId(merges.get(id)!) : id
  const keep = <T extends { id: string }>(records: T[]) => records.filter((record) => !suppressed.has(record.id))

  const names = keep(artifact.names).map((record) => ({ ...record, characterId: characterId(record.characterId) }))
  const mentions = keep(artifact.mentions).map((record) => ({ ...record, characterId: characterId(record.characterId) }))
  const observations = keep(artifact.observations).map((record) => ({ ...record, characterId: characterId(record.characterId) }))
  const relationships = keep(artifact.relationships).map((record) => ({
    ...record,
    fromCharacterId: characterId(record.fromCharacterId),
    toCharacterId: characterId(record.toCharacterId),
  }))
  const summaries = keep(artifact.summaries)
    .filter((record) => record.inputRecordIds.every((id) => !suppressed.has(id)))
    .map((record) => ({ ...record, characterId: characterId(record.characterId) }))
  const storySentences = keep(artifact.storySentences)
    .filter((record) => record.inputRecordIds.every((id) => !suppressed.has(id)))
    .map((record) => ({ ...record, characterId: characterId(record.characterId) }))

  return {
    ...artifact,
    entities: [...new Set(artifact.entities.map((entity) => characterId(entity.id)))]
      .map((id) => ({ id })),
    names: replaceOrAppend(names, overrides.names),
    mentions,
    observations: replaceOrAppend(observations, overrides.observations),
    relationships: replaceOrAppend(relationships, overrides.relationships),
    summaries: replaceOrAppend(summaries, overrides.summaries),
    storySentences: replaceOrAppend(storySentences, overrides.storySentences),
  }
}
