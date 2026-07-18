import { describe, expect, it } from 'vitest'
import { parseEpub } from './epub'
import { createTestEpub } from '../test/epubFixture'

describe('EPUB parsing', () => {
  it('reads metadata, follows spine order, and assigns stable contiguous positions', async () => {
    const bytes = createTestEpub()
    const first = await parseEpub(bytes)
    const second = await parseEpub(bytes)

    expect(first.metadata).toMatchObject({ title: 'Fixture Book', author: 'Fixture Author', language: 'en' })
    expect(first.chapters.map((chapter) => chapter.title)).toEqual(['Arrival', 'The Keeper'])
    expect(first.blocks.map((block) => block.sourceSequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(first.blocks[1].text).toBe('Mara met Mr Gray at the gate.')
    expect(first.blocks.map((block) => block.id)).toEqual(second.blocks.map((block) => block.id))
    expect(first.fingerprint).toBe(second.fingerprint)
  })

  it.each(['2.0', '3.0'] as const)('parses EPUB %s packages', async (version) => {
    const parsed = await parseEpub(createTestEpub(`EPUB ${version}`, { version }))
    expect(parsed.metadata.title).toBe(`EPUB ${version}`)
    expect(parsed.chapters).toHaveLength(2)
  })

  it('bases block IDs on spine paths, so skipped front matter does not renumber them', async () => {
    const ordinary = await parseEpub(createTestEpub())
    const withFrontMatter = await parseEpub(createTestEpub('Fixture Book', { frontMatter: true }))
    expect(withFrontMatter.blocks.map((block) => block.id)).toEqual(ordinary.blocks.map((block) => block.id))
  })

  it('rejects malformed archives and EPUBs without readable chapters', async () => {
    await expect(parseEpub(new Uint8Array([1, 2, 3]))).rejects.toThrow(/readable EPUB archive/i)
    await expect(parseEpub(createTestEpub('Empty', { noReadableChapters: true }))).rejects.toThrow(/No readable chapters/i)
  })
})
