export type BookId = 'alice' | 'frankenstein' | 'neuromancer' | (string & {})

export type EpubMetadata = {
  title: string
  author: string
  language?: string
  identifier?: string
}

export type EpubBlockKind = 'heading' | 'paragraph'

export type EpubBlock = {
  id: string
  chapterId: string
  spineHref: string
  sourceSequence: number
  kind: EpubBlockKind
  text: string
}

export type EpubChapter = {
  id: string
  href: string
  title: string
  blocks: EpubBlock[]
  firstSequence: number
  lastSequence: number
}

export type ParsedEpub = {
  fingerprint: string
  metadata: EpubMetadata
  chapters: EpubChapter[]
  blocks: EpubBlock[]
  maxSequence: number
  cover?: {
    mimeType: string
    bytes: Uint8Array
  }
}

export type SourcedRecord = {
  sourceSequence: number
  sourceBlockId: string
}

export type CharacterEntity = {
  id: string
}

export type NameFact = SourcedRecord & {
  id: string
  characterId: string
  name: string
  kind: 'name' | 'alias' | 'title'
}

export type CharacterMention = SourcedRecord & {
  id: string
  characterId: string
  startOffset: number
  endOffset: number
}

export type ObservationKind =
  | 'Introduction'
  | 'Attribute'
  | 'Action'
  | 'Relationship'
  | 'Location'
  | 'Goal'
  | 'Revelation'
  | 'Status'

export type Observation = SourcedRecord & {
  id: string
  characterId: string
  kind: ObservationKind
  summary: string
  evidenceBlockIds: string[]
}

export type RelationshipEvent = SourcedRecord & {
  id: string
  fromCharacterId: string
  toCharacterId: string
  label: string
  detail: string
  state: 'starts' | 'updates' | 'ends'
}

export type SummarySnapshot = SourcedRecord & {
  id: string
  characterId: string
  summary: string
  inputRecordIds: string[]
}

export type StorySentence = SourcedRecord & {
  id: string
  characterId: string
  sentence: string
  inputRecordIds: string[]
  importance: 'major' | 'supporting' | 'minor'
}

export type ProcessedBookArtifact = {
  schemaVersion: 2
  promptVersion: string
  bookId: BookId
  fingerprint: string
  generatedAt: string
  sourceBlockCount: number
  entities: CharacterEntity[]
  names: NameFact[]
  mentions: CharacterMention[]
  observations: Observation[]
  relationships: RelationshipEvent[]
  summaries: SummarySnapshot[]
  storySentences: StorySentence[]
}

export type PreparedBook = {
  id: BookId
  title: string
  author: string
  description: string
  fingerprint: string
  publicPath: string
  license: 'CC0' | 'local-only'
  coverTone: 'sage' | 'wine' | 'electric'
  artifact: ProcessedBookArtifact
}

export type SafeRelationship = RelationshipEvent & {
  relatedCharacterId: string
  relatedName: string
}

export type SafeCharacterProfile = {
  characterId: string
  currentSequence: number
  displayName: string
  aliases: NameFact[]
  observations: Observation[]
  relationships: SafeRelationship[]
  summary: string
  summarySnapshot?: SummarySnapshot
  storySentences: StorySentence[]
  storySoFar: string
  latestSourceSequence: number
}

export type SafeGraphNode = {
  id: string
  label: string
  sourceSequence: number
  selected: boolean
}

export type SafeGraphEdge = {
  id: string
  from: string
  to: string
  label: string
  detail: string
  sourceSequence: number
}

export type SafeGraph = {
  nodes: SafeGraphNode[]
  edges: SafeGraphEdge[]
}

export type ReadingProgress = {
  bookId: BookId
  chapterId: string
  currentSequence: number
  settings: {
    fontScale: number
    lineHeight: number
  }
  updatedAt: string
}
