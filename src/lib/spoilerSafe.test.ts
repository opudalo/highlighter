import { describe, expect, it } from 'vitest'
import { assertViewWithinBoundary, getSafeCharacterProfile, getSafeGraph } from './spoilerSafe'
import { fixtureArtifact } from '../test/fixtureArtifact'

describe('spoiler-safe selectors', () => {
  it('filters every sourced view record at every canonical position', () => {
    for (let sequence = 1; sequence <= fixtureArtifact.sourceBlockCount; sequence += 1) {
      for (const entity of fixtureArtifact.entities) {
        const profile = getSafeCharacterProfile(fixtureArtifact, entity.id, sequence)
        const graph = getSafeGraph(fixtureArtifact, entity.id, sequence)
        expect(assertViewWithinBoundary(profile, graph, sequence)).toBe(true)
      }
    }
  })

  it('does not leak a future canonical name, summary sentence, or relationship', () => {
    const beforeName = getSafeCharacterProfile(fixtureArtifact, 'c-elias', 6)
    const beforeRelationship = getSafeCharacterProfile(fixtureArtifact, 'c-elias', 7)
    const graph = getSafeGraph(fixtureArtifact, 'c-elias', 7)

    expect(beforeName?.displayName).toBe('Mr Gray')
    expect(JSON.stringify(beforeName)).not.toContain('Elias')
    expect(JSON.stringify(beforeRelationship)).not.toContain('father')
    expect(graph.edges).toHaveLength(0)
  })

  it('reveals identity and relationship exactly at their source positions', () => {
    expect(getSafeCharacterProfile(fixtureArtifact, 'c-elias', 7)?.displayName).toBe('Elias')
    const atReveal = getSafeCharacterProfile(fixtureArtifact, 'c-elias', 8)
    expect(atReveal?.summary).toContain('Keeper’s son')
    expect(atReveal?.relationships).toEqual([expect.objectContaining({ relatedName: 'The Keeper', sourceSequence: 8 })])
  })
})
