import { describe, expect, it } from 'vitest'
import { applyArtifactOverrides } from './overrides'
import { buildChunks, promptFor, restoreCheckpoint } from './ingest'
import { runExtractionProvider, runProviderChain } from './providers'
import { fixtureArtifact } from '../src/test/fixtureArtifact'
import { backfillStoryLayers, buildBoundedOverview } from './backfillStoryLayers'

const emptyExtraction = () => ({
  entities: [], names: [], observations: [], relationships: [], summaries: [], storySentences: [],
})

describe('preprocessing pipeline', () => {
  it('packs chapters in forward order without splitting small chapters', () => {
    const blocks = Array.from({ length: 4 }, (_, index) => ({
      id: `b-${index + 1}`,
      chapterId: index < 2 ? 'one' : 'two',
      spineHref: `${index < 2 ? 'one' : 'two'}.xhtml`,
      sourceSequence: index + 1,
      kind: 'paragraph' as const,
      text: `Block ${index + 1}`,
    }))
    const chunks = buildChunks([
      { title: 'One', blocks: blocks.slice(0, 2) },
      { title: 'Two', blocks: blocks.slice(2) },
    ])

    expect(chunks).toHaveLength(1)
    expect(chunks[0].blocks.map((block) => block.sourceSequence)).toEqual([1, 2, 3, 4])
  })

  it('splits only an oversized chapter into forward token windows', () => {
    const blocks = [1, 2, 3].map((sequence) => ({
      id: `large-${sequence}`,
      chapterId: 'large',
      spineHref: 'large.xhtml',
      sourceSequence: sequence,
      kind: 'paragraph' as const,
      text: 'word '.repeat(5_000),
    }))
    const chunks = buildChunks([{ title: 'Large', blocks }])
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.label.startsWith('Large · part'))).toBe(true)
    expect(chunks.flatMap((chunk) => chunk.blocks.map((block) => block.sourceSequence))).toEqual([1, 2, 3])
  })

  it('validates stub provider output against the common schema', async () => {
    const result = await runExtractionProvider('stub', 'unused', emptyExtraction())
    expect(result).toEqual(emptyExtraction())
  })

  it('constructs forward-only prompts and restores only matching checkpoints', () => {
    const [chunk] = buildChunks([{ title: 'Now', blocks: [{
      id: 'block-now',
      chapterId: 'now',
      spineHref: 'now.xhtml',
      sourceSequence: 6,
      kind: 'paragraph' as const,
      text: 'Only present context.',
    }] }])
    const artifact = {
      ...fixtureArtifact,
      sourceBlockCount: 5,
      names: fixtureArtifact.names.filter((record) => record.sourceSequence <= 5),
      mentions: fixtureArtifact.mentions.filter((record) => record.sourceSequence <= 5),
      observations: fixtureArtifact.observations.filter((record) => record.sourceSequence <= 5),
      relationships: fixtureArtifact.relationships.filter((record) => record.sourceSequence <= 5),
      summaries: fixtureArtifact.summaries.filter((record) => record.sourceSequence <= 5),
      storySentences: fixtureArtifact.storySentences.filter((record) => record.sourceSequence <= 5),
    }
    const prompt = promptFor(chunk, artifact)
    expect(prompt).toContain('Only present context.')
    expect(prompt).not.toContain('Elias called the Keeper his father.')

    const extraction = emptyExtraction()
    expect(restoreCheckpoint({ promptVersion: 'forward-only-story-layers-v2', chunkHash: chunk.hash, extraction }, chunk, artifact)).toEqual(extraction)
    expect(restoreCheckpoint({ promptVersion: 'stale', chunkHash: chunk.hash, extraction }, chunk, artifact)).toBeUndefined()
    expect(restoreCheckpoint({ promptVersion: 'forward-only-story-layers-v2', chunkHash: 'stale', extraction }, chunk, artifact)).toBeUndefined()
  })

  it('moves observations and dependent snapshots to their latest supporting source', () => {
    const [chunk] = buildChunks([{ title: 'Evidence', blocks: [
      { id: 'block-6', chapterId: 'now', spineHref: 'now.xhtml', sourceSequence: 6, kind: 'paragraph' as const, text: 'First claim.' },
      { id: 'block-7', chapterId: 'now', spineHref: 'now.xhtml', sourceSequence: 7, kind: 'paragraph' as const, text: 'Complete support.' },
    ] }])
    const extraction = {
      entities: [],
      names: [],
      observations: [{
        id: 'obs-supported-later', characterId: 'c-elias', kind: 'Revelation' as const,
        summary: 'The complete fact is now supported.', evidenceBlockIds: ['block-6', 'block-7'],
        sourceSequence: 6, sourceBlockId: 'block-6',
      }],
      relationships: [],
      summaries: [{
        id: 'summary-supported-later', characterId: 'c-elias', summary: 'The complete fact is now supported.',
        inputRecordIds: ['obs-supported-later'], sourceSequence: 6, sourceBlockId: 'block-6',
      }],
      storySentences: [{
        id: 'story-supported-later', characterId: 'c-elias', sentence: 'The complete fact is now supported.',
        inputRecordIds: ['obs-supported-later'], importance: 'major' as const,
        sourceSequence: 6, sourceBlockId: 'block-6',
      }],
    }
    const restored = restoreCheckpoint({ promptVersion: 'forward-only-story-layers-v2', chunkHash: chunk.hash, extraction }, chunk, fixtureArtifact)
    expect(restored?.observations[0]).toMatchObject({ sourceSequence: 7, sourceBlockId: 'block-7' })
    expect(restored?.summaries[0]).toMatchObject({ sourceSequence: 7, sourceBlockId: 'block-7' })
    expect(restored?.storySentences[0]).toMatchObject({ sourceSequence: 7, sourceBlockId: 'block-7' })
  })

  it('retries the primary provider and resumes with the fallback', async () => {
    const attempts: string[] = []
    const empty = emptyExtraction()
    const result = await runProviderChain(
      ['codex', 'claude'],
      'prompt',
      (value) => value,
      async (provider) => {
        attempts.push(provider)
        if (provider === 'codex') throw new Error('usage exhausted')
        return empty
      },
    )
    expect(attempts).toEqual(['codex', 'codex', 'claude'])
    expect(result).toEqual({ provider: 'claude', value: empty })
  })

  it('applies checked character merges and record suppression', () => {
    const override = {
      suppressIds: ['obs-elias-7'],
      mergeCharacters: [{ from: 'c-keeper', into: 'c-elias' }],
    }
    const overridden = applyArtifactOverrides(fixtureArtifact, override)
    expect(overridden.observations.some((record) => record.id === 'obs-elias-7')).toBe(false)
    expect(overridden.entities.some((entity) => entity.id === 'c-keeper')).toBe(false)
    expect(applyArtifactOverrides(fixtureArtifact, override)).toEqual(overridden)
  })

  it('backfills append-only story beats and bounded early overviews deterministically', () => {
    const legacy = {
      ...fixtureArtifact,
      schemaVersion: 1 as const,
      promptVersion: 'legacy-v1',
      summaries: fixtureArtifact.summaries.filter((record) => record.sourceSequence >= 8),
      storySentences: undefined,
    }
    const upgraded = backfillStoryLayers(legacy)
    const repeated = backfillStoryLayers(legacy)
    const early = upgraded.summaries.find((record) => record.sourceSequence === 7)

    expect(upgraded).toEqual(repeated)
    expect(upgraded.schemaVersion).toBe(2)
    expect(upgraded.storySentences.map((record) => record.sourceSequence)).toEqual([2, 7, 8])
    expect(early?.summary).toContain('Elias')
    expect(early?.inputRecordIds).not.toContain('obs-elias-8')
    expect(buildBoundedOverview(fixtureArtifact.observations, 'Elias', 12).summary.split(/\s+/u).length).toBeLessThanOrEqual(12)
  })
})
