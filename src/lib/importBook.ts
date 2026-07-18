import { assertValidArtifact } from './artifact'
import { parseEpub } from './epub'
import type { ParsedEpub, PreparedBook } from '../types'

export type OpenedBook = {
  catalog: PreparedBook
  parsed: ParsedEpub
  source: 'bundled' | 'upload' | 'stored'
}

const assetUrl = (path: string) => new URL(path, document.baseURI).toString()

export async function loadBundledBook(catalog: PreparedBook): Promise<OpenedBook> {
  const response = await fetch(assetUrl(catalog.publicPath))
  if (!response.ok) throw new Error(`${catalog.title} is not bundled in this build.`)
  const parsed = await parseEpub(await response.arrayBuffer())
  assertValidArtifact(catalog.artifact, parsed)
  return { catalog, parsed, source: 'bundled' }
}

export async function loadUploadedBook(file: Blob, catalog: PreparedBook): Promise<OpenedBook> {
  const parsed = await parseEpub(await file.arrayBuffer())
  assertValidArtifact(catalog.artifact, parsed)
  return { catalog, parsed, source: 'upload' }
}
