import { activeRelationships } from './artifact'
import type {
  NameFact,
  ProcessedBookArtifact,
  SafeCharacterProfile,
  SafeGraph,
  SafeGraphNode,
} from '../types'

export const isKnown = <T extends { sourceSequence: number }>(record: T, currentSequence: number) =>
  record.sourceSequence <= currentSequence

const latestDisplayName = (names: NameFact[], characterId: string) => {
  const eligible = names
    .filter((record) => record.characterId === characterId)
    .sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id))
  return [...eligible].reverse().find((record) => record.kind === 'name')?.name
    ?? eligible.at(-1)?.name
}

export function getSafeCharacterProfile(
  artifact: ProcessedBookArtifact,
  characterId: string,
  currentSequence: number,
): SafeCharacterProfile | null {
  // The boundary is applied to every source collection before any view-model
  // grouping, naming, relationship reduction, or summary selection happens.
  const names = artifact.names.filter((record) => isKnown(record, currentSequence))
  const observations = artifact.observations.filter((record) => isKnown(record, currentSequence))
  const summaries = artifact.summaries.filter((record) => isKnown(record, currentSequence))
  const relationships = activeRelationships(
    artifact.relationships.filter((record) => isKnown(record, currentSequence)),
  )

  const displayName = latestDisplayName(names, characterId)
  if (!displayName) return null
  const characterNames = names
    .filter((record) => record.characterId === characterId)
    .sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id))
  const characterObservations = observations
    .filter((record) => record.characterId === characterId)
    .sort((a, b) => a.sourceSequence - b.sourceSequence)
  const snapshot = summaries
    .filter((record) => record.characterId === characterId)
    .sort((a, b) => a.sourceSequence - b.sourceSequence)
    .at(-1)
  const safeRelationships = relationships
    .filter((record) => record.fromCharacterId === characterId || record.toCharacterId === characterId)
    .flatMap((record) => {
      const relatedCharacterId = record.fromCharacterId === characterId
        ? record.toCharacterId
        : record.fromCharacterId
      const relatedName = latestDisplayName(names, relatedCharacterId)
      return relatedName ? [{ ...record, relatedCharacterId, relatedName }] : []
    })
  const sources = [
    ...characterNames.map((record) => record.sourceSequence),
    ...characterObservations.map((record) => record.sourceSequence),
    ...safeRelationships.map((record) => record.sourceSequence),
    ...(snapshot ? [snapshot.sourceSequence] : []),
  ]

  return {
    characterId,
    currentSequence,
    displayName,
    aliases: characterNames,
    observations: characterObservations,
    relationships: safeRelationships,
    summary: snapshot?.summary ?? characterObservations.at(-1)?.summary ?? `${displayName} has just entered the story.`,
    latestSourceSequence: Math.max(...sources),
  }
}

export function getSafeGraph(
  artifact: ProcessedBookArtifact,
  selectedCharacterId: string,
  currentSequence: number,
): SafeGraph {
  const names = artifact.names.filter((record) => isKnown(record, currentSequence))
  const relationships = activeRelationships(
    artifact.relationships.filter((record) => isKnown(record, currentSequence)),
  ).filter((record) => record.fromCharacterId === selectedCharacterId || record.toCharacterId === selectedCharacterId)
  const characterIds = new Set([selectedCharacterId])
  relationships.forEach((record) => {
    characterIds.add(record.fromCharacterId)
    characterIds.add(record.toCharacterId)
  })

  const nodes: SafeGraphNode[] = [...characterIds].flatMap((id) => {
    const characterNames = names
      .filter((record) => record.characterId === id)
      .sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id))
    const label = latestDisplayName(names, id)
    if (!label || characterNames.length === 0) return []
    return [{
      id,
      label,
      sourceSequence: characterNames.at(-1)!.sourceSequence,
      selected: id === selectedCharacterId,
    }]
  })
  const nodeIds = new Set(nodes.map((node) => node.id))

  return {
    nodes,
    edges: relationships
      .filter((record) => nodeIds.has(record.fromCharacterId) && nodeIds.has(record.toCharacterId))
      .map((record) => ({
        id: record.id,
        from: record.fromCharacterId,
        to: record.toCharacterId,
        label: record.label,
        detail: record.detail,
        sourceSequence: record.sourceSequence,
      })),
  }
}

export function assertViewWithinBoundary(
  profile: SafeCharacterProfile | null,
  graph: SafeGraph,
  currentSequence: number,
) {
  if (!profile) return graph.nodes.every((node) => node.sourceSequence <= currentSequence)
  return [
    ...profile.aliases,
    ...profile.observations,
    ...profile.relationships,
    ...graph.nodes,
    ...graph.edges,
  ].every((record) => record.sourceSequence <= currentSequence)
}
