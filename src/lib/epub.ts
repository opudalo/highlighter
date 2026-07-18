import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'
import type { EpubBlock, EpubChapter, EpubMetadata, ParsedEpub } from '../types'

const XML_MIME = 'application/xml'
const CONTAINER_PATH = 'META-INF/container.xml'
const BLOCK_ELEMENTS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'])
const HEADING_ELEMENTS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const EXCLUDED_SEMANTICS = [
  'acknowledgments',
  'afterword',
  'bibliography',
  'colophon',
  'copyright-page',
  'cover',
  'dedication',
  'endnotes',
  'glossary',
  'halftitlepage',
  'imprint',
  'landmarks',
  'loi',
  'titlepage',
  'toc',
  'uncopyright',
]

type ZipEntries = Record<string, Uint8Array>

type ManifestItem = {
  id: string
  href: string
  mediaType: string
  properties: string
}

type SpineItem = {
  idref: string
  linear: boolean
}

const elementName = (node: XmlNode) => ((node as XmlElement).localName || node.nodeName.split(':').at(-1) || '').toLowerCase()

const elementsByLocalName = (root: XmlDocument | XmlElement, name: string): XmlElement[] => {
  const matches: XmlElement[] = []
  const all = root.getElementsByTagName('*')
  for (let index = 0; index < all.length; index += 1) {
    const element = all.item(index)
    if (element && elementName(element) === name) matches.push(element)
  }
  return matches
}

const firstByLocalName = (root: XmlDocument | XmlElement, name: string) =>
  elementsByLocalName(root, name)[0]

const parseXml = (xml: string, label: string) => {
  const document = new DOMParser().parseFromString(xml, XML_MIME)
  const parserErrors = elementsByLocalName(document, 'parsererror')
  if (!document.documentElement || parserErrors.length > 0) {
    throw new Error(`Could not parse ${label}.`)
  }
  return document
}

const normalizeText = (value: string) =>
  value
    .replace(/[\u200B\u2060\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()

const dirname = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

const normalizePath = (path: string) => {
  const output: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') output.pop()
    else output.push(segment)
  }
  return output.join('/')
}

const stablePathToken = (path: string) => {
  const normalized = normalizePath(path).toLowerCase()
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  let hash = 2166136261
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `${slug}-${(hash >>> 0).toString(36)}`
}

const resolvePath = (baseFile: string, relative: string) => {
  const decoded = decodeURIComponent(relative.split('#')[0])
  return normalizePath(`${dirname(baseFile)}/${decoded}`)
}

const readEntry = (entries: ZipEntries, path: string) => {
  const value = entries[path]
  if (!value) throw new Error(`EPUB entry is missing: ${path}`)
  return strFromU8(value)
}

const sha256 = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

const attr = (element: XmlElement | undefined, name: string) => element?.getAttribute(name) ?? ''

const metadataText = (document: XmlDocument, name: string) =>
  normalizeText(firstByLocalName(document, name)?.textContent ?? '')

const getPackage = (entries: ZipEntries) => {
  if (!entries[CONTAINER_PATH]) throw new Error('This file is not a valid EPUB: container.xml is missing.')
  const container = parseXml(readEntry(entries, CONTAINER_PATH), CONTAINER_PATH)
  const rootfile = firstByLocalName(container, 'rootfile')
  const packagePath = attr(rootfile, 'full-path')
  if (!packagePath) throw new Error('This EPUB does not declare a package document.')
  const packageDocument = parseXml(readEntry(entries, packagePath), packagePath)
  return { packagePath, packageDocument }
}

const getManifest = (packageDocument: XmlDocument): ManifestItem[] =>
  elementsByLocalName(packageDocument, 'item').map((item) => ({
    id: attr(item, 'id'),
    href: attr(item, 'href'),
    mediaType: attr(item, 'media-type'),
    properties: attr(item, 'properties'),
  }))

const getSpine = (packageDocument: XmlDocument): SpineItem[] =>
  elementsByLocalName(packageDocument, 'itemref').map((item) => ({
    idref: attr(item, 'idref'),
    linear: attr(item, 'linear').toLowerCase() !== 'no',
  }))

const getMetadata = (packageDocument: XmlDocument): EpubMetadata => ({
  title: metadataText(packageDocument, 'title') || 'Untitled book',
  author: metadataText(packageDocument, 'creator') || 'Unknown author',
  language: metadataText(packageDocument, 'language') || undefined,
  identifier: metadataText(packageDocument, 'identifier') || undefined,
})

const getSemanticTokens = (document: XmlDocument) => {
  const values: string[] = []
  const all = document.getElementsByTagName('*')
  for (let index = 0; index < all.length; index += 1) {
    const element = all.item(index)
    if (!element) continue
    values.push(attr(element, 'epub:type'), attr(element, 'type'))
    for (let attrIndex = 0; attrIndex < element.attributes.length; attrIndex += 1) {
      const attribute = element.attributes.item(attrIndex)
      if (attribute?.name.endsWith(':type')) values.push(attribute.value)
    }
  }
  return values.join(' ').toLowerCase().split(/\s+/).filter(Boolean)
}

const extractBlockElements = (document: XmlDocument) => {
  const body = firstByLocalName(document, 'body')
  if (!body) return []
  const output: XmlElement[] = []
  const visit = (node: XmlNode) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue
      const element = child as XmlElement
      if (BLOCK_ELEMENTS.has(elementName(element))) {
        if (normalizeText(element.textContent ?? '')) output.push(element)
      } else {
        visit(element)
      }
    }
  }
  visit(body)
  return output
}

const isReadingDocument = (href: string, document: XmlDocument, blockElements: XmlElement[]) => {
  if (/(?:cubierta|sinopsis|titulo|info|dedicatoria|acknowledgements|afterword|autor|frontcover)\.xhtml?$/i.test(href)) {
    return false
  }
  const semanticTokens = getSemanticTokens(document)
  if (semanticTokens.some((token) => EXCLUDED_SEMANTICS.includes(token))) return false
  if (blockElements.filter((element) => elementName(element) === 'p').length >= 3) return true
  return /(?:chapter|part|prologue|epilogue|coda|\/c\d+\.)/i.test(href)
}

const chapterTitle = (href: string, elements: XmlElement[], chapterNumber: number) => {
  const heading = elements.find((element) => HEADING_ELEMENTS.has(elementName(element)))
  const text = normalizeText(heading?.textContent ?? '')
  if (text) return text
  const filename = href.split('/').at(-1)?.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
  return filename ? filename.replace(/\b\w/g, (letter) => letter.toUpperCase()) : `Chapter ${chapterNumber}`
}

const getCover = (entries: ZipEntries, packagePath: string, packageDocument: XmlDocument, manifest: ManifestItem[]) => {
  const metaCover = elementsByLocalName(packageDocument, 'meta')
    .find((item) => attr(item, 'name').toLowerCase() === 'cover')
  const coverId = attr(metaCover, 'content')
  const coverItem = manifest.find((item) => item.properties.split(/\s+/).includes('cover-image'))
    ?? manifest.find((item) => item.id === coverId)
    ?? manifest.find((item) => /cover/i.test(item.id) && item.mediaType.startsWith('image/'))
  if (!coverItem) return undefined
  const path = resolvePath(packagePath, coverItem.href)
  const bytes = entries[path]
  return bytes ? { mimeType: coverItem.mediaType, bytes } : undefined
}

export async function parseEpub(input: ArrayBuffer | Uint8Array): Promise<ParsedEpub> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let entries: ZipEntries
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('This file is not a readable EPUB archive.')
  }

  const { packagePath, packageDocument } = getPackage(entries)
  const manifest = getManifest(packageDocument)
  const manifestById = new Map(manifest.map((item) => [item.id, item]))
  const spine = getSpine(packageDocument)
  const metadata = getMetadata(packageDocument)
  const chapters: EpubChapter[] = []
  let sourceSequence = 0

  for (const spineItem of spine) {
    if (!spineItem.linear) continue
    const item = manifestById.get(spineItem.idref)
    if (!item || !/xhtml|html/i.test(item.mediaType)) continue
    const href = resolvePath(packagePath, item.href)
    if (!entries[href]) continue
    const document = parseXml(readEntry(entries, href), href)
    const elements = extractBlockElements(document)
    if (!isReadingDocument(href, document, elements)) continue

    const chapterIndex = chapters.length + 1
    const pathToken = stablePathToken(href)
    const chapterId = `chapter-${pathToken}`
    const blocks: EpubBlock[] = elements.map((element, index) => {
      sourceSequence += 1
      return {
        id: `block-${pathToken}-${index + 1}`,
        chapterId,
        spineHref: href,
        sourceSequence,
        kind: HEADING_ELEMENTS.has(elementName(element)) ? 'heading' : 'paragraph',
        text: normalizeText(element.textContent ?? ''),
      }
    })
    if (blocks.length === 0) continue
    chapters.push({
      id: chapterId,
      href,
      title: chapterTitle(href, elements, chapterIndex),
      blocks,
      firstSequence: blocks[0].sourceSequence,
      lastSequence: blocks.at(-1)!.sourceSequence,
    })
  }

  if (chapters.length === 0) throw new Error('No readable chapters were found in this EPUB.')
  const blocks = chapters.flatMap((chapter) => chapter.blocks)
  return {
    fingerprint: await sha256(bytes),
    metadata,
    chapters,
    blocks,
    maxSequence: blocks.at(-1)?.sourceSequence ?? 0,
    cover: getCover(entries, packagePath, packageDocument, manifest),
  }
}

export function blockBySequence(book: ParsedEpub, sequence: number) {
  return book.blocks.find((block) => block.sourceSequence === sequence)
}

export function chapterForSequence(book: ParsedEpub, sequence: number) {
  return book.chapters.find((chapter) => sequence >= chapter.firstSequence && sequence <= chapter.lastSequence)
    ?? book.chapters[0]
}

export function createCoverUrl(book: ParsedEpub) {
  if (!book.cover) return undefined
  return URL.createObjectURL(new Blob([book.cover.bytes as BlobPart], { type: book.cover.mimeType }))
}
