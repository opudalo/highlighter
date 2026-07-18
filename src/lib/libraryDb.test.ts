import { deleteDB } from 'idb'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getImportedBook,
  getReadingProgress,
  resetDatabaseConnectionForTests,
  saveImportedBook,
  saveReadingProgress,
} from './libraryDb'

afterEach(async () => {
  await resetDatabaseConnectionForTests()
  await deleteDB('highlighter-library')
})

describe('local library persistence', () => {
  it('restores imported EPUB blobs and the exact reading boundary', async () => {
    const file = new NodeBlob(['epub bytes'], { type: 'application/epub+zip' }) as unknown as Blob
    await saveImportedBook({
      id: 'neuromancer',
      fingerprint: '0366da0b0f1c495b8bbda96c96cb91801bc2c7a7f82a7ec2049b87ef8d2a5ebf',
      file,
      title: 'Neuromancer',
      author: 'William Gibson',
      importedAt: '2026-07-18T12:00:00.000Z',
    })
    await saveReadingProgress({
      bookId: 'neuromancer',
      chapterId: 'chapter-one',
      currentSequence: 42,
      settings: { fontScale: 1.1, lineHeight: 1.7 },
      updatedAt: '2026-07-18T12:05:00.000Z',
    })

    const stored = await getImportedBook('neuromancer')
    const progress = await getReadingProgress('neuromancer')
    expect(stored?.fingerprint).toMatch(/^0366da0b/)
    expect(stored?.file).toMatchObject({ size: 10, type: 'application/epub+zip' })
    expect(progress).toEqual({
      bookId: 'neuromancer',
      chapterId: 'chapter-one',
      currentSequence: 42,
      settings: { fontScale: 1.1, lineHeight: 1.7 },
      updatedAt: '2026-07-18T12:05:00.000Z',
    })
  })
})
