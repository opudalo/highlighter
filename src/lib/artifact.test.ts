import { describe, expect, it } from 'vitest'
import { locateMentions, validateArtifact } from './artifact'
import { parseEpub } from './epub'
import { createTestEpub } from '../test/epubFixture'
import { fixtureArtifact } from '../test/fixtureArtifact'

describe('processed artifacts', () => {
  it('rejects a summary that depends on a future record', () => {
    const invalid = structuredClone(fixtureArtifact)
    invalid.summaries[0].inputRecordIds.push('obs-elias-8')
    expect(validateArtifact(invalid).issues).toContain('summary-elias-2 depends on future input obs-elias-8.')
  })

  it('locates explicit character names with exact, non-overlapping offsets', async () => {
    const book = await parseEpub(createTestEpub())
    const mentions = locateMentions(book, fixtureArtifact)
    const gray = mentions.find((mention) => mention.characterId === 'c-elias' && mention.sourceSequence === 2)
    const block = book.blocks.find((item) => item.id === gray?.sourceBlockId)

    expect(block?.text.slice(gray?.startOffset, gray?.endOffset)).toBe('Mr Gray')
  })

  it('never backfills a mention from a name fact established later', async () => {
    const book = await parseEpub(createTestEpub())
    const earlier = book.blocks.find((block) => block.text.includes('Mr Gray'))!
    const later = book.blocks.find((block) => block.text.includes('I am Elias'))!
    const mentions = locateMentions(book, {
      names: [{
        id: 'name-gray-late',
        characterId: 'c-elias',
        name: 'Mr Gray',
        kind: 'alias',
        sourceSequence: later.sourceSequence,
        sourceBlockId: later.id,
      }],
    })

    expect(earlier.sourceSequence).toBeLessThan(later.sourceSequence)
    expect(mentions.some((mention) => mention.sourceSequence === earlier.sourceSequence)).toBe(false)
  })

  it('rejects a persisted mention that depends on a future name fact', async () => {
    const book = await parseEpub(createTestEpub())
    const invalid = structuredClone(fixtureArtifact)
    invalid.fingerprint = book.fingerprint
    invalid.sourceBlockCount = book.maxSequence
    invalid.names = invalid.names.map((fact) => ({ ...fact, sourceBlockId: book.blocks[fact.sourceSequence - 1].id }))
    invalid.observations = []
    invalid.relationships = []
    invalid.summaries = []
    const earlier = book.blocks.find((block) => block.text.includes('Mr Gray'))!
    invalid.mentions = [{
      id: 'future-backed-mention',
      characterId: 'c-elias',
      sourceSequence: earlier.sourceSequence,
      sourceBlockId: earlier.id,
      startOffset: earlier.text.indexOf('Mr Gray'),
      endOffset: earlier.text.indexOf('Mr Gray') + 'Mr Gray'.length,
    }]
    invalid.names = invalid.names.map((fact) => fact.characterId === 'c-elias' && fact.name === 'Mr Gray'
      ? { ...fact, sourceSequence: book.maxSequence, sourceBlockId: book.blocks.at(-1)!.id }
      : fact)

    expect(validateArtifact(invalid, book).issues).toContain('future-backed-mention is not supported by one unambiguous eligible name fact.')
  })

  it('stops linking a surface form once it has multiple eligible identities', async () => {
    const book = await parseEpub(createTestEpub())
    const firstGray = book.blocks.find((block) => block.text.includes('Mr Gray'))!
    const revealedGray = book.blocks.find((block) => block.text.includes('I am Elias'))!
    const mentions = locateMentions(book, {
      names: [
        { id: 'gray-one', characterId: 'c-elias', name: 'Mr Gray', kind: 'name', sourceSequence: firstGray.sourceSequence, sourceBlockId: firstGray.id },
        { id: 'gray-two', characterId: 'c-keeper', name: 'Mr Gray', kind: 'name', sourceSequence: revealedGray.sourceSequence, sourceBlockId: revealedGray.id },
      ],
    })

    expect(mentions.some((mention) => mention.sourceSequence === firstGray.sourceSequence && mention.characterId === 'c-elias')).toBe(true)
    expect(mentions.some((mention) => mention.sourceSequence === revealedGray.sourceSequence)).toBe(false)
  })

  it('rejects observation evidence from after the observation boundary', async () => {
    const book = await parseEpub(createTestEpub())
    const invalid = structuredClone(fixtureArtifact)
    invalid.fingerprint = book.fingerprint
    invalid.sourceBlockCount = book.maxSequence
    invalid.names = invalid.names.map((fact) => ({ ...fact, sourceBlockId: book.blocks[fact.sourceSequence - 1].id }))
    invalid.mentions = []
    invalid.relationships = []
    invalid.summaries = []
    invalid.observations = [{
      ...invalid.observations[0],
      sourceSequence: 2,
      sourceBlockId: book.blocks[1].id,
      evidenceBlockIds: [book.blocks[2].id],
    }]

    expect(validateArtifact(invalid, book).issues).toContain(`${invalid.observations[0].id} depends on future evidence ${book.blocks[2].id}.`)
  })

  it('flags long verbatim source phrases in a published derived record', async () => {
    const book = await parseEpub(createTestEpub())
    const source = book.blocks.find((block) => block.text.split(' ').length >= 10)!
    const invalid = structuredClone(fixtureArtifact)
    invalid.fingerprint = book.fingerprint
    invalid.sourceBlockCount = book.maxSequence
    invalid.names = []
    invalid.mentions = []
    invalid.relationships = []
    invalid.summaries = []
    invalid.observations = [{
      id: 'obs-verbatim',
      characterId: 'c-elias',
      kind: 'Action',
      summary: source.text,
      evidenceBlockIds: [source.id],
      sourceSequence: source.sourceSequence,
      sourceBlockId: source.id,
    }]

    expect(validateArtifact(invalid, book).issues).toContain('obs-verbatim contains a long verbatim source phrase.')
  })
})
