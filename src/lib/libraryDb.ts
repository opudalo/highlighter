import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { BookId, ReadingProgress } from '../types'

type StoredBook = {
  id: BookId
  fingerprint: string
  file: Blob
  title: string
  author: string
  importedAt: string
}

interface HighlighterDatabase extends DBSchema {
  books: {
    key: string
    value: StoredBook
  }
  progress: {
    key: string
    value: ReadingProgress
  }
}

let databasePromise: Promise<IDBPDatabase<HighlighterDatabase>> | undefined

const database = () => {
  if (!databasePromise) {
    databasePromise = openDB<HighlighterDatabase>('highlighter-library', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'bookId' })
      },
    })
  }
  return databasePromise
}

export async function saveImportedBook(book: StoredBook) {
  return (await database()).put('books', book)
}

export async function getImportedBook(bookId: BookId) {
  return (await database()).get('books', bookId)
}

export async function removeImportedBook(bookId: BookId) {
  return (await database()).delete('books', bookId)
}

export async function saveReadingProgress(progress: ReadingProgress) {
  return (await database()).put('progress', progress)
}

export async function getReadingProgress(bookId: BookId) {
  return (await database()).get('progress', bookId)
}

export async function resetDatabaseConnectionForTests() {
  const pending = databasePromise
  databasePromise = undefined
  ;(await pending)?.close()
}
