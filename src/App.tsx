import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  Fingerprint,
  LockKeyhole,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { preparedBookByFingerprint, preparedBooks, publicBooks } from './data/catalog'
import { assertValidArtifact } from './lib/artifact'
import { blockBySequence, chapterForSequence, parseEpub } from './lib/epub'
import { loadBundledBook, loadUploadedBook, type OpenedBook } from './lib/importBook'
import {
  getImportedBook,
  getReadingProgress,
  saveImportedBook,
  saveReadingProgress,
} from './lib/libraryDb'
import { getSafeCharacterProfile } from './lib/spoilerSafe'
import type {
  BookId,
  CharacterMention,
  EpubBlock,
  EpubChapter,
  PreparedBook,
  StorySentence,
} from './types'

const IMPORT_TIMEOUT_MS = 30_000
const SUPPORTED_IMPORT_DELAY_MS = 2_800
const ESTIMATED_WORDS_PER_PAGE = 275

type ImportState = {
  status: 'idle' | 'processing' | 'unsupported' | 'error'
  progress: number
  stage: string
  filename?: string
  metadata?: string
  message?: string
}

type ActiveReader = {
  opened: OpenedBook
  initialSequence: number
  settings: ReadingSettings
}

type ReadingSettings = {
  fontScale: number
  lineHeight: number
}

type CharacterPreviewState = {
  characterId: string
  sequence: number
  left: number
  top: number
  above: boolean
}

const DEFAULT_READING_SETTINGS: ReadingSettings = { fontScale: 1, lineHeight: 1.72 }

const uniqueBy = <T,>(values: T[], key: (value: T) => string) => {
  const seen = new Set<string>()
  return values.filter((value) => {
    const id = key(value)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const closestBlockToMarker = (blocks: HTMLElement[], marker: number) => {
  let low = 0
  let high = blocks.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (blocks[middle].getBoundingClientRect().top < marker) low = middle + 1
    else high = middle
  }
  const after = blocks[low]
  const before = blocks[Math.max(0, low - 1)]
  return Math.abs(before.getBoundingClientRect().top - marker) <= Math.abs(after.getBoundingClientRect().top - marker)
    ? before
    : after
}

function Brand({ onHome }: { onHome?: () => void }) {
  return (
    <button type="button" className="brand" onClick={onHome} aria-label="Open SPOIL NOT library">
      <span>SPOIL NOT</span>
    </button>
  )
}

function TrialBook({
  book,
  loading,
  locallyStored,
  onOpen,
  onUpload,
}: {
  book: PreparedBook
  loading: boolean
  locallyStored: boolean
  onOpen: (book: PreparedBook) => void
  onUpload: () => void
}) {
  const isLocalOnly = book.license === 'local-only'
  const canOpen = !isLocalOnly || import.meta.env.DEV || locallyStored
  return (
    <article className="trial-book">
      <button
        type="button"
        onClick={() => canOpen ? onOpen(book) : onUpload()}
        disabled={loading}
        aria-label={canOpen ? `Read ${book.title}` : `Upload your copy of ${book.title}`}
      >
        <div>
          <h2>{book.title}</h2>
          <p>{book.author}</p>
        </div>
        <span>{loading ? 'Opening…' : canOpen ? 'Read' : 'Upload your copy'} <ArrowRight size={16} aria-hidden="true" /></span>
      </button>
    </article>
  )
}

function LibraryScreen({
  importState,
  localBookAvailable,
  loadingBookId,
  onOpen,
  onUpload,
  onDrop,
}: {
  importState: ImportState
  localBookAvailable: boolean
  loadingBookId?: BookId
  onOpen: (book: PreparedBook) => void
  onUpload: () => void
  onDrop: (file: File) => void
}) {
  const [dragging, setDragging] = useState(false)
  const unsupported = importState.status === 'unsupported'
  const error = importState.status === 'error'

  return (
    <div
      className={`landing-screen${dragging ? ' dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files[0]
        if (file) onDrop(file)
      }}
    >
      <main className="landing-main">
        <div className="landing-logo"><Brand /></div>

        <section className="landing-intro" aria-label="What SPOIL NOT does">
          <h1>Ever read a book, looked up a character online and spoiled the ending?</h1>
          <p className="landing-answer">Yeah, me too.</p>
          <p>SPOIL NOT shows you only what the story has revealed at your exact place. The same character has a different story on page 10 and page 100.</p>
        </section>

        {(unsupported || error) && (
          <section className="landing-message" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <p>{importState.message}</p>
            <button type="button" onClick={onUpload}>Try another EPUB</button>
          </section>
        )}

        <section className="landing-trials" aria-label="Trial books">
          <p className="landing-instruction">Open a book, then click any underlined character name to see their story so far.</p>
          <div className="trial-books">
            {preparedBooks.map((book) => (
              <TrialBook
                key={book.id}
                book={book}
                loading={loadingBookId === book.id}
                locallyStored={book.id === 'neuromancer' && localBookAvailable}
                onOpen={onOpen}
                onUpload={onUpload}
              />
            ))}
          </div>
          <button type="button" className="landing-import" onClick={onUpload}>Open an EPUB</button>
        </section>
      </main>
      {dragging && <div className="landing-drop" aria-hidden="true">Drop your EPUB here</div>}
    </div>
  )
}

function ImportOverlay({ state, onCancel }: { state: ImportState; onCancel: () => void }) {
  return (
    <div className="import-overlay" role="dialog" aria-modal="true" aria-label="Preparing EPUB">
      <div className="import-dialog">
        <div className="processing-orbit"><Fingerprint size={29} aria-hidden="true" /><span /><span /></div>
        <p className="eyebrow">Preparing on this device</p>
        <h1>{state.stage}</h1>
        <p className="import-filename">{state.filename}</p>
        <div className="import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress)}>
          <span style={{ width: `${state.progress}%` }} />
        </div>
        <div className="import-progress-copy"><span>{Math.round(state.progress)}%</span><span>{state.metadata ?? 'Reading package metadata…'}</span></div>
        <div className="privacy-note"><LockKeyhole size={15} aria-hidden="true" /><p><strong>Your book is staying here.</strong><span>Nothing is being uploaded to a server.</span></p></div>
        <button type="button" className="text-button" onClick={onCancel}>Cancel import</button>
      </div>
    </div>
  )
}

function MentionedText({
  block,
  mentions,
  selectedCharacterId,
  onSelect,
  onPreview,
  onPreviewEnd,
}: {
  block: EpubBlock
  mentions: CharacterMention[]
  selectedCharacterId?: string
  onSelect: (characterId: string, sequence: number) => void
  onPreview: (characterId: string, sequence: number, target: HTMLElement, immediate?: boolean) => void
  onPreviewEnd: () => void
}) {
  if (mentions.length === 0) return <>{block.text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const mention of mentions) {
    if (mention.startOffset < cursor || mention.endOffset > block.text.length) continue
    if (mention.startOffset > cursor) parts.push(block.text.slice(cursor, mention.startOffset))
    const text = block.text.slice(mention.startOffset, mention.endOffset)
    parts.push(
      <button
        type="button"
        className={`character-mention${selectedCharacterId === mention.characterId ? ' selected' : ''}`}
        key={mention.id}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') onPreview(mention.characterId, mention.sourceSequence, event.currentTarget)
        }}
        onPointerLeave={onPreviewEnd}
        onFocus={(event) => onPreview(mention.characterId, mention.sourceSequence, event.currentTarget, true)}
        onBlur={onPreviewEnd}
        onClick={() => {
          onPreviewEnd()
          onSelect(mention.characterId, mention.sourceSequence)
        }}
        aria-label={`Open ${text} character context at paragraph ${mention.sourceSequence}`}
      >
        {text}
      </button>,
    )
    cursor = mention.endOffset
  }
  if (cursor < block.text.length) parts.push(block.text.slice(cursor))
  return <>{parts}</>
}

const compactTimeline = (sentences: StorySentence[], limit = 7) => {
  if (sentences.length <= limit) return sentences
  const candidates = uniqueBy(
    [
      ...sentences.filter((record) => record.importance === 'major'),
      ...sentences.filter((record) => record.importance === 'supporting').slice(-2),
      ...sentences.slice(-1),
    ],
    (record) => record.id,
  ).sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id))
  if (candidates.length <= limit) return candidates
  return uniqueBy(
    [...candidates.slice(0, 2), ...candidates.slice(-(limit - 2))],
    (record) => record.id,
  ).sort((a, b) => a.sourceSequence - b.sourceSequence || a.id.localeCompare(b.id))
}

function CharacterDossier({
  opened,
  characterId,
  currentSequence,
  open,
  onClose,
  onSelectCharacter,
}: {
  opened: OpenedBook
  characterId?: string
  currentSequence: number
  open: boolean
  onClose: () => void
  onSelectCharacter: (characterId: string) => void
}) {
  const [tab, setTab] = useState<'timeline' | 'connections'>('timeline')
  const [showAllMoments, setShowAllMoments] = useState(false)
  const [showFullContext, setShowFullContext] = useState(false)
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 1250px)').matches)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const returnFocusRef = useRef<HTMLElement>()
  const profile = useMemo(
    () => characterId ? getSafeCharacterProfile(opened.catalog.artifact, characterId, currentSequence) : null,
    [characterId, currentSequence, opened.catalog.artifact],
  )
  useEffect(() => {
    setTab('timeline')
    setShowAllMoments(false)
    setShowFullContext(false)
  }, [characterId])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1250px)')
    const update = () => setIsNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!open || !isNarrow) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (document.activeElement instanceof HTMLElement && !panelRef.current?.contains(document.activeElement)) {
      returnFocusRef.current = document.activeElement
    }
    closeRef.current?.focus()
    return () => { document.body.style.overflow = previousOverflow }
  }, [open, characterId, isNarrow])

  const closeAndRestoreFocus = useCallback(() => {
    if (isNarrow) returnFocusRef.current?.focus()
    onClose()
  }, [isNarrow, onClose])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndRestoreFocus()
      if (event.key !== 'Tab' || !isNarrow) return
      const focusable = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    panel.addEventListener('keydown', onKeyDown)
    return () => panel.removeEventListener('keydown', onKeyDown)
  }, [closeAndRestoreFocus, isNarrow, open])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !open || isNarrow) return
    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) closeAndRestoreFocus()
    }
    document.addEventListener('pointerdown', closeFromOutside, true)
    return () => document.removeEventListener('pointerdown', closeFromOutside, true)
  }, [closeAndRestoreFocus, isNarrow, open])

  const aliases = profile ? uniqueBy(profile.aliases, (fact) => fact.name.toLocaleLowerCase()) : []
  const alternateNames = profile
    ? aliases.filter((fact) => fact.name.toLocaleLowerCase() !== profile.displayName.toLocaleLowerCase())
    : []
  const compactMoments = profile ? compactTimeline(profile.storySentences) : []
  const visibleMoments = profile && showAllMoments ? profile.storySentences : compactMoments
  const hiddenMomentCount = profile ? profile.storySentences.length - compactMoments.length : 0
  const panelId = `dossier-panel-${tab}`
  const tabId = `dossier-tab-${tab}`
  const hasFullContext = Boolean(profile?.storySoFar && profile.storySoFar !== profile.summary)

  useEffect(() => {
    if (!hasFullContext) setShowFullContext(false)
  }, [hasFullContext])

  const selectConnection = (relatedCharacterId: string) => {
    setTab('timeline')
    setShowAllMoments(false)
    setShowFullContext(false)
    onSelectCharacter(relatedCharacterId)
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  return (
    <>
      <div className={`dossier-scrim${open ? ' open' : ''}`} onClick={closeAndRestoreFocus} aria-hidden="true" />
      <aside
        ref={panelRef}
        className={`dossier${open ? ' open' : ''}`}
        aria-label="Known up to here character context"
        aria-hidden={!open}
      >
        {profile && (
          <>
            <div className="profile-heading">
              <div>
                <h2 ref={headingRef} tabIndex={-1}>{profile.displayName}</h2>
                {alternateNames.length > 0 && (
                  <p>also {alternateNames.map((fact) => `“${fact.name}”`).join(', ')}</p>
                )}
              </div>
              <button ref={closeRef} type="button" className="dossier-close" onClick={closeAndRestoreFocus} aria-label="Close character context"><X size={17} /></button>
            </div>
            {showFullContext ? (
              <div className="dossier-scroll full-context-scroll">
                <section className="dossier-section full-context-section">
                  <p>
                    {profile.storySoFar}{' '}
                    <button type="button" onClick={() => setShowFullContext(false)}>Read short summary</button>
                  </p>
                </section>
              </div>
            ) : (
              <>
                <p className="profile-summary">
                  {profile.summary}
                  {hasFullContext && (
                    <> <button type="button" onClick={() => setShowFullContext(true)}>Read full context</button></>
                  )}
                </p>
                <div className="dossier-tabs" role="tablist" aria-label="Character context sections">
                  <button id="dossier-tab-timeline" type="button" role="tab" aria-controls="dossier-panel-timeline" aria-selected={tab === 'timeline'} onClick={() => setTab('timeline')}>Timeline</button>
                  <button id="dossier-tab-connections" type="button" role="tab" aria-controls="dossier-panel-connections" aria-selected={tab === 'connections'} onClick={() => setTab('connections')}>Connections</button>
                </div>
                <div
                  className="dossier-scroll"
                  id={panelId}
                  role="tabpanel"
                  aria-labelledby={tabId}
                >
                  {tab === 'timeline' ? (
                    <section className="dossier-section timeline-section">
                      <h3 className="visually-hidden">Timeline</h3>
                      {visibleMoments.length > 0 ? (
                        <>
                          <ol>{visibleMoments.map((moment) => (
                            <li key={moment.id}>{moment.sentence}</li>
                          ))}</ol>
                          {hiddenMomentCount > 0 && (
                            <button type="button" className="timeline-more" onClick={() => setShowAllMoments((value) => !value)}>
                              {showAllMoments ? 'Show essential moments' : `Show ${hiddenMomentCount} more moments`}
                            </button>
                          )}
                        </>
                      ) : <p className="empty-copy">No timeline moments yet.</p>}
                    </section>
                  ) : (
                    <section className="dossier-section connection-list">
                      <h3 className="visually-hidden">Connections</h3>
                      {profile.relationships.length > 0 ? profile.relationships.map((relationship) => (
                        <button className="connection-row" type="button" key={relationship.id} onClick={() => selectConnection(relationship.relatedCharacterId)}>
                          <span className="connection-copy"><strong>{relationship.relatedName}</strong><span>{relationship.label}</span><small>{relationship.detail}</small></span>
                          <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      )) : <p className="empty-copy">No connections yet.</p>}
                    </section>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </aside>
    </>
  )
}

const chapterLocation = (bookTitle: string, chapter: EpubChapter) => {
  const chapterName = chapter.title.trim()
  const headingSubtitle = chapter.blocks.find((block) =>
    block.kind === 'heading'
      && block.text.trim().toLocaleLowerCase() !== chapterName.toLocaleLowerCase(),
  )?.text.trim()
  const structuralChapterName = /^(?:[ivxlcdm]+|chapter|letter|volume|book|part)\b/i.test(chapterName)
  const shortOpening = structuralChapterName
    ? chapter.blocks.find((block) => block.kind === 'paragraph' && block.text.trim().length <= 80)?.text.trim()
    : undefined
  const subtitle = headingSubtitle ?? shortOpening
  const section = subtitle ? `${chapterName}. ${subtitle}` : chapterName
  return `${bookTitle} · ${section}`
}

const estimateChapterPages = (chapters: EpubChapter[]) => {
  const pages = new Map<string, number>()
  let page = 1
  for (const chapter of chapters) {
    pages.set(chapter.id, page)
    const wordCount = chapter.blocks.reduce(
      (total, block) => total + (block.text.trim().match(/\S+/gu)?.length ?? 0),
      0,
    )
    page += Math.max(1, Math.ceil(wordCount / ESTIMATED_WORDS_PER_PAGE))
  }
  return pages
}

function ReaderScreen({ active, onLibrary }: { active: ActiveReader; onLibrary: () => void }) {
  const { opened, initialSequence, settings } = active
  const [currentSequence, setCurrentSequence] = useState(initialSequence)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | undefined>(() =>
    opened.catalog.artifact.names
      .filter((record) => record.sourceSequence <= initialSequence)
      .sort((a, b) => b.sourceSequence - a.sourceSequence)[0]?.characterId,
  )
  const [dossierOpen, setDossierOpen] = useState(false)
  const [contentsOpen, setContentsOpen] = useState(false)
  const [preview, setPreview] = useState<CharacterPreviewState>()
  const currentChapter = chapterForSequence(opened.parsed, currentSequence)
  const readerRef = useRef<HTMLElement>(null)
  const blockElementsRef = useRef<HTMLElement[]>([])
  const frameRef = useRef<number>()
  const previewTimerRef = useRef<number>()
  const mentionBoundaryLockRef = useRef(false)

  const mentionsByBlock = useMemo(() => {
    const map = new Map<string, CharacterMention[]>()
    for (const mention of opened.catalog.artifact.mentions) {
      const list = map.get(mention.sourceBlockId) ?? []
      list.push(mention)
      map.set(mention.sourceBlockId, list.sort((a, b) => a.startOffset - b.startOffset))
    }
    return map
  }, [opened.catalog.artifact.mentions])
  const chapterPages = useMemo(
    () => estimateChapterPages(opened.parsed.chapters),
    [opened.parsed.chapters],
  )

  const updateFromViewport = useCallback(() => {
    if (mentionBoundaryLockRef.current) return
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      if (mentionBoundaryLockRef.current) return
      const blocks = blockElementsRef.current
      if (blocks.length === 0) return
      const marker = window.innerHeight * 0.34
      const nearest = closestBlockToMarker(blocks, marker)
      const sequence = Number(nearest.dataset.sourceSequence)
      if (Number.isFinite(sequence)) setCurrentSequence(sequence)
    })
  }, [])

  useEffect(() => {
    const paragraphs = [...(readerRef.current?.querySelectorAll<HTMLElement>('.reader-block:not(.block-heading)[data-source-sequence]') ?? [])]
    blockElementsRef.current = paragraphs.length > 0
      ? paragraphs
      : [...(readerRef.current?.querySelectorAll<HTMLElement>('[data-source-sequence]') ?? [])]
    const releaseMentionBoundary = (event: Event) => {
      if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
      mentionBoundaryLockRef.current = false
    }
    window.addEventListener('scroll', updateFromViewport, { passive: true })
    window.addEventListener('resize', updateFromViewport)
    window.addEventListener('wheel', releaseMentionBoundary, { passive: true })
    window.addEventListener('touchmove', releaseMentionBoundary, { passive: true })
    window.addEventListener('pointerdown', releaseMentionBoundary, { passive: true })
    window.addEventListener('keydown', releaseMentionBoundary)
    updateFromViewport()
    return () => {
      window.removeEventListener('scroll', updateFromViewport)
      window.removeEventListener('resize', updateFromViewport)
      window.removeEventListener('wheel', releaseMentionBoundary)
      window.removeEventListener('touchmove', releaseMentionBoundary)
      window.removeEventListener('pointerdown', releaseMentionBoundary)
      window.removeEventListener('keydown', releaseMentionBoundary)
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      blockElementsRef.current = []
    }
  }, [updateFromViewport])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void saveReadingProgress({
        bookId: opened.catalog.id,
        chapterId: currentChapter.id,
        currentSequence,
        settings,
        updatedAt: new Date().toISOString(),
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [currentChapter.id, currentSequence, opened.catalog.id, settings])

  useEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-source-sequence="${initialSequence}"]`)
    if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }))
  }, [initialSequence])

  const selectCharacter = (characterId: string, sequence: number) => {
    mentionBoundaryLockRef.current = true
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    setCurrentSequence(sequence)
    setSelectedCharacterId(characterId)
    setDossierOpen(true)
  }

  const clearCharacterPreview = useCallback(() => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = undefined
    setPreview(undefined)
  }, [])

  const queueCharacterPreview = useCallback((
    characterId: string,
    sequence: number,
    target: HTMLElement,
    immediate = false,
  ) => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
    const rect = target.getBoundingClientRect()
    const width = 286
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 16)
    const above = rect.bottom + 150 > window.innerHeight
    const top = above ? rect.top - 10 : rect.bottom + 10
    previewTimerRef.current = window.setTimeout(() => {
      setPreview({ characterId, sequence, left, top, above })
      previewTimerRef.current = undefined
    }, immediate ? 0 : 550)
  }, [])

  useEffect(() => () => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
  }, [])

  useEffect(() => {
    if (!preview) return
    window.addEventListener('scroll', clearCharacterPreview, { passive: true })
    return () => window.removeEventListener('scroll', clearCharacterPreview)
  }, [clearCharacterPreview, preview])

  const goToChapter = (chapter: EpubChapter) => {
    mentionBoundaryLockRef.current = false
    setContentsOpen(false)
    setCurrentSequence(chapter.firstSequence)
    requestAnimationFrame(() => {
      document.getElementById(`reader-${chapter.id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }

  const progress = Math.round((currentSequence / opened.parsed.maxSequence) * 100)
  const previewProfile = useMemo(
    () => preview
      ? getSafeCharacterProfile(opened.catalog.artifact, preview.characterId, preview.sequence)
      : null,
    [opened.catalog.artifact, preview],
  )

  useEffect(() => {
    if (!contentsOpen) return
    const closeContents = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContentsOpen(false)
    }
    window.addEventListener('keydown', closeContents)
    return () => window.removeEventListener('keydown', closeContents)
  }, [contentsOpen])

  return (
    <div
      className="reader-shell"
      style={{ '--reader-font-scale': settings.fontScale, '--reader-line-height': settings.lineHeight } as CSSProperties}
    >
      <header className="reader-topbar">
        <Brand onHome={onLibrary} />
        <button
          type="button"
          className="reader-location"
          aria-label={`Open contents, ${chapterLocation(opened.parsed.metadata.title, currentChapter)}`}
          aria-expanded={contentsOpen}
          aria-controls="reader-contents"
          onClick={() => setContentsOpen((value) => !value)}
        >
          <span>{chapterLocation(opened.parsed.metadata.title, currentChapter)}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        <span className="reader-progress" aria-label={`${progress}% through the book`}>{progress}%</span>
        <span className="visually-hidden" aria-live="polite" aria-label={`Context is safe through paragraph ${currentSequence}`}>Context is safe through paragraph {currentSequence}</span>
      </header>

      {contentsOpen && <button type="button" className="contents-scrim" aria-label="Close contents" onClick={() => setContentsOpen(false)} />}
      <nav id="reader-contents" className={`reader-contents${contentsOpen ? ' open' : ''}`} aria-label="Chapters" aria-hidden={!contentsOpen}>
        <div className="contents-heading">
          <span>{opened.parsed.metadata.title}</span>
          <button type="button" onClick={() => setContentsOpen(false)} aria-label="Close contents"><X size={16} /></button>
        </div>
        <div className="contents-list">
          {opened.parsed.chapters.map((chapter) => (
            <button
              type="button"
              key={chapter.id}
              className={chapter.id === currentChapter.id ? 'active' : ''}
              aria-current={chapter.id === currentChapter.id ? 'page' : undefined}
              onClick={() => goToChapter(chapter)}
            >
              <strong>{chapter.title}</strong>
              <span className="contents-page" aria-label={`Estimated page ${chapterPages.get(chapter.id) ?? 1}`}>{chapterPages.get(chapter.id) ?? 1}</span>
            </button>
          ))}
        </div>
      </nav>

      <main ref={readerRef} className="reader-main" id="reader">
        <h1 className="visually-hidden">{opened.parsed.metadata.title}</h1>
        {opened.parsed.chapters.map((chapter) => (
          <section
            className="reader-chapter"
            id={`reader-${chapter.id}`}
            key={chapter.id}
            aria-labelledby={`reader-${chapter.id}-title`}
          >
            <header className="chapter-heading">
              <h2 id={`reader-${chapter.id}-title`}>{chapter.title}</h2>
            </header>
            <div className="chapter-body">
              {chapter.blocks.map((block) => {
                const current = block.sourceSequence === currentSequence
                if (block.kind === 'heading') {
                  if (block.text.trim().toLocaleLowerCase() === chapter.title.trim().toLocaleLowerCase()) return null
                  return <h3 key={block.id} id={block.id} className={`reader-block block-heading${current ? ' current' : ''}`} data-source-sequence={block.sourceSequence}>{block.text}</h3>
                }
                return (
                  <div key={block.id} id={block.id} className={`reader-block${current ? ' current' : ''}`} data-source-sequence={block.sourceSequence}>
                    <span className="paragraph-number" aria-hidden="true">{block.sourceSequence}</span>
                    <p><MentionedText block={block} mentions={mentionsByBlock.get(block.id) ?? []} selectedCharacterId={dossierOpen ? selectedCharacterId : undefined} onSelect={selectCharacter} onPreview={queueCharacterPreview} onPreviewEnd={clearCharacterPreview} /></p>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </main>

      {preview && previewProfile && (
        <div
          className={`character-preview${preview.above ? ' above' : ''}`}
          role="tooltip"
          style={{ left: preview.left, top: preview.top }}
        >
          <p>{previewProfile.summary}</p>
        </div>
      )}

      <CharacterDossier
        opened={opened}
        characterId={selectedCharacterId}
        currentSequence={currentSequence}
        open={dossierOpen}
        onClose={() => setDossierOpen(false)}
        onSelectCharacter={setSelectedCharacterId}
      />
    </div>
  )
}

function App() {
  const [activeReader, setActiveReader] = useState<ActiveReader>()
  const [loadingBookId, setLoadingBookId] = useState<BookId>()
  const [localBookAvailable, setLocalBookAvailable] = useState(false)
  const [importState, setImportState] = useState<ImportState>({ status: 'idle', progress: 0, stage: '' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timersRef = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current = []
  }, [])

  useEffect(() => {
    void getImportedBook('neuromancer').then((book) => setLocalBookAvailable(Boolean(book))).catch(() => undefined)
    return clearTimers
  }, [clearTimers])

  const enterReader = useCallback(async (opened: OpenedBook) => {
    const progress = await getReadingProgress(opened.catalog.id).catch(() => undefined)
    const initialSequence = progress && progress.currentSequence <= opened.parsed.maxSequence
      ? progress.currentSequence
      : opened.parsed.chapters[0].firstSequence
    setActiveReader({ opened, initialSequence, settings: progress?.settings ?? DEFAULT_READING_SETTINGS })
    setImportState({ status: 'idle', progress: 0, stage: '' })
    window.scrollTo({ top: 0 })
  }, [])

  const openPrepared = useCallback(async (catalog: PreparedBook) => {
    setLoadingBookId(catalog.id)
    try {
      if (catalog.license === 'local-only' && !import.meta.env.DEV) {
        const stored = await getImportedBook(catalog.id)
        if (!stored) { fileInputRef.current?.click(); return }
        await enterReader(await loadUploadedBook(stored.file, catalog))
      } else {
        await enterReader(await loadBundledBook(catalog))
      }
    } catch (error) {
      setImportState({ status: 'error', progress: 0, stage: '', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoadingBookId(undefined)
    }
  }, [enterReader])

  const processFile = useCallback(async (file: File) => {
    clearTimers()
    const startedAt = Date.now()
    setImportState({ status: 'processing', progress: 4, stage: 'Opening the book', filename: file.name })
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      const progress = Math.min(96, 6 + (elapsed / IMPORT_TIMEOUT_MS) * 90)
      const stage = elapsed < 4_000 ? 'Mapping the spine'
        : elapsed < 11_000 ? 'Resolving the prepared edition'
          : elapsed < 21_000 ? 'Checking character timelines'
            : 'Giving the machines one last moment'
      setImportState((state) => state.status === 'processing' ? { ...state, progress, stage } : state)
    }, 350)
    timersRef.current.push(interval)

    try {
      const parsed = await parseEpub(await file.arrayBuffer())
      const catalog = preparedBookByFingerprint(parsed.fingerprint)
      const metadata = `${parsed.metadata.title} · ${parsed.chapters.length} sections · ${parsed.maxSequence.toLocaleString()} blocks`
      setImportState((state) => ({ ...state, progress: Math.max(state.progress, 18), stage: 'Fingerprint matched locally', metadata }))
      if (catalog) {
        assertValidArtifact(catalog.artifact, parsed)
        await saveImportedBook({
          id: catalog.id,
          fingerprint: parsed.fingerprint,
          file,
          title: parsed.metadata.title,
          author: parsed.metadata.author,
          importedAt: new Date().toISOString(),
        })
        if (catalog.id === 'neuromancer') setLocalBookAvailable(true)
        const remaining = Math.max(450, SUPPORTED_IMPORT_DELAY_MS - (Date.now() - startedAt))
        const timer = window.setTimeout(() => {
          clearTimers()
          void enterReader({ catalog, parsed, source: 'upload' })
        }, remaining)
        timersRef.current.push(timer)
      } else {
        const remaining = Math.max(0, IMPORT_TIMEOUT_MS - (Date.now() - startedAt))
        const timer = window.setTimeout(() => {
          clearTimers()
          setImportState({
            status: 'unsupported',
            progress: 100,
            stage: '',
            filename: file.name,
            metadata,
            message: 'We tried our best, but the machines are too tired. Please open one of the already available books.',
          })
        }, remaining)
        timersRef.current.push(timer)
      }
    } catch (error) {
      clearTimers()
      setImportState({
        status: 'error',
        progress: 0,
        stage: '',
        filename: file.name,
        message: error instanceof Error ? error.message : 'This file is not a readable EPUB.',
      })
    }
  }, [clearTimers, enterReader])

  if (activeReader) return <ReaderScreen active={activeReader} onLibrary={() => { setActiveReader(undefined); window.scrollTo({ top: 0 }) }} />

  return (
    <>
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".epub,application/epub+zip"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void processFile(file)
          event.currentTarget.value = ''
        }}
      />
      <LibraryScreen
        importState={importState}
        localBookAvailable={localBookAvailable}
        loadingBookId={loadingBookId}
        onOpen={(book) => void openPrepared(book)}
        onUpload={() => fileInputRef.current?.click()}
        onDrop={(file) => void processFile(file)}
      />
      {importState.status === 'processing' && <ImportOverlay state={importState} onCancel={() => { clearTimers(); setImportState({ status: 'idle', progress: 0, stage: '' }) }} />}
    </>
  )
}

export default App
