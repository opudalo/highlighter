import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  Fingerprint,
  Library,
  LockKeyhole,
  Menu,
  Network,
  Quote,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
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
import { getSafeCharacterProfile, getSafeGraph } from './lib/spoilerSafe'
import type {
  BookId,
  CharacterMention,
  EpubBlock,
  EpubChapter,
  PreparedBook,
  SafeGraph,
} from './types'

const IMPORT_TIMEOUT_MS = 30_000
const SUPPORTED_IMPORT_DELAY_MS = 2_800

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

function Brand({ onHome }: { onHome?: () => void }) {
  return (
    <button type="button" className="brand" onClick={onHome} aria-label="Open Highlighter library">
      <span className="brand-mark" aria-hidden="true"><Fingerprint size={19} /></span>
      <span>Highlighter</span>
    </button>
  )
}

function BookCover({ book, compact = false }: { book: PreparedBook; compact?: boolean }) {
  return (
    <div className={`book-cover tone-${book.coverTone}${compact ? ' compact' : ''}`} aria-hidden="true">
      <span className="cover-glow" />
      <span className="cover-sigil">✦</span>
      <strong>{book.title}</strong>
      <small>{book.author}</small>
    </div>
  )
}

function BookCard({
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
    <article className="library-card">
      <BookCover book={book} />
      <div className="library-card-copy">
        <div className="card-meta">
          <span>{isLocalOnly ? 'Prepared edition' : 'Public domain · CC0'}</span>
          {isLocalOnly && <LockKeyhole size={13} aria-hidden="true" />}
        </div>
        <h3>{book.title}</h3>
        <p className="card-author">{book.author}</p>
        <p>{book.description}</p>
        <div className="card-actions">
          {canOpen ? (
            <button type="button" className="primary-button" onClick={() => onOpen(book)} disabled={loading}>
              {loading ? <span className="button-spinner" /> : <BookOpen size={16} aria-hidden="true" />}
              {loading ? 'Opening…' : locallyStored && isLocalOnly ? 'Continue locally' : 'Read now'}
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={onUpload}>
              <Upload size={16} aria-hidden="true" /> Upload your copy
            </button>
          )}
        </div>
      </div>
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
    <div className="library-screen">
      <header className="library-topbar">
        <Brand />
        <div className="library-top-actions">
          <span className="local-pill"><ShieldCheck size={14} aria-hidden="true" /> Books stay on this device</span>
          <button type="button" className="ghost-button" onClick={onUpload}><Upload size={16} aria-hidden="true" /> Import EPUB</button>
        </div>
      </header>

      <main className="library-main">
        <section className="library-hero">
          <div className="hero-copy">
            <p className="eyebrow"><Sparkles size={14} aria-hidden="true" /> Remember the story, never the spoiler</p>
            <h1>Every character,<br /><em>known up to here.</em></h1>
            <p>Read naturally. Tap a name and Highlighter reconstructs only what the book has established at your exact place.</p>
            <div className="hero-actions">
              <button type="button" className="primary-button large" onClick={onUpload}><Upload size={17} aria-hidden="true" /> Import your EPUB</button>
              <a className="text-link" href="#prepared-library">Browse prepared books <ArrowRight size={15} aria-hidden="true" /></a>
            </div>
          </div>
          <div className="hero-demo" aria-label="Example spoiler-safe character context">
            <div className="demo-page">
              <span>Sample story · Chapter IV</span>
              <p>“Wait by the northern gate,” <mark>Mara</mark> said.</p>
              <p>“The map changes after sunset,” replied the keeper.</p>
            </div>
            <div className="demo-dossier">
              <span className="micro-label">Known up to here</span>
              <div className="demo-profile"><span>M</span><div><strong>Mara</strong><small>4 known moments</small></div></div>
              <p>A careful cartographer searching for a route through the northern pass.</p>
              <div className="demo-safe"><ShieldCheck size={13} /> Future events hidden</div>
            </div>
          </div>
        </section>

        <section
          className={`drop-zone${dragging ? ' dragging' : ''}`}
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
          <div className="drop-icon"><FileText size={22} aria-hidden="true" /></div>
          <div><strong>Drop an EPUB to add it to your library</strong><span>Parsed locally · never uploaded · matched by fingerprint</span></div>
          <button type="button" onClick={onUpload}>Choose file</button>
        </section>

        {(unsupported || error) && (
          <section className={`import-result ${unsupported ? 'unsupported' : 'error'}`} role="status">
            <CircleAlert size={22} aria-hidden="true" />
            <div>
              <h2>{unsupported ? 'The machines need a little lie-down.' : 'We could not read that EPUB.'}</h2>
              <p>{importState.message}</p>
              {importState.metadata && <span>{importState.metadata}</span>}
            </div>
            <button type="button" onClick={onUpload}>Try another</button>
          </section>
        )}

        <section className="prepared-library" id="prepared-library">
          <div className="section-heading">
            <div>
              <p className="eyebrow"><Library size={14} aria-hidden="true" /> Prepared library</p>
              <h2>Start with a book we already know</h2>
            </div>
            <p>Each edition has a validated, source-linked character map. Context grows paragraph by paragraph.</p>
          </div>
          <div className="book-grid">
            {preparedBooks.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                loading={loadingBookId === book.id}
                locallyStored={book.id === 'neuromancer' && localBookAvailable}
                onOpen={onOpen}
                onUpload={onUpload}
              />
            ))}
          </div>
        </section>

        <section className="how-it-works">
          <span className="micro-label">How the boundary holds</span>
          <div className="steps-grid">
            <div><span>01</span><h3>Read on your terms</h3><p>Your visible paragraph is the canonical knowledge boundary.</p></div>
            <div><span>02</span><h3>Open any name</h3><p>Names stay keyboard-friendly and work with a single tap.</p></div>
            <div><span>03</span><h3>See only the past</h3><p>Every fact is filtered by its source before the dossier is built.</p></div>
          </div>
        </section>
      </main>
      <footer className="library-footer"><Brand /><p>Local-first fiction context for curious readers.</p><span>Hackathon edition · no accounts · no tracking</span></footer>
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
}: {
  block: EpubBlock
  mentions: CharacterMention[]
  selectedCharacterId?: string
  onSelect: (characterId: string, sequence: number) => void
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
        onClick={() => onSelect(mention.characterId, mention.sourceSequence)}
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

function RelationshipGraph({ graph }: { graph: SafeGraph }) {
  const width = 360
  const height = 260
  const center = { x: width / 2, y: height / 2 }
  const selected = graph.nodes.find((node) => node.selected)
  const neighbors = graph.nodes.filter((node) => !node.selected).sort((a, b) => a.label.localeCompare(b.label))
  const positions = new Map<string, { x: number; y: number }>()
  if (selected) positions.set(selected.id, center)
  neighbors.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(neighbors.length, 1)
    positions.set(node.id, { x: center.x + Math.cos(angle) * 103, y: center.y + Math.sin(angle) * 86 })
  })

  if (!selected || graph.edges.length === 0) {
    return <div className="graph-empty"><Network size={24} aria-hidden="true" /><p>No reader-known connections at this paragraph.</p></div>
  }

  return (
    <svg className="relationship-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Relationship graph for ${selected.label}`}>
      <g className="graph-edges">
        {graph.edges.map((edge) => {
          const from = positions.get(edge.from)
          const to = positions.get(edge.to)
          if (!from || !to) return null
          return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
        })}
      </g>
      {graph.nodes.map((node) => {
        const position = positions.get(node.id)
        if (!position) return null
        const initials = node.label.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
        return (
          <g className={`graph-node${node.selected ? ' selected' : ''}`} key={node.id} transform={`translate(${position.x} ${position.y})`}>
            <circle r={node.selected ? 35 : 29} />
            <text className="graph-initials" textAnchor="middle" dy="5">{initials}</text>
            <text className="graph-label" textAnchor="middle" y={node.selected ? 54 : 47}>{node.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function CharacterDossier({
  opened,
  characterId,
  currentSequence,
  open,
  onClose,
}: {
  opened: OpenedBook
  characterId?: string
  currentSequence: number
  open: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<'timeline' | 'connections'>('timeline')
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement>()
  const profile = useMemo(
    () => characterId ? getSafeCharacterProfile(opened.catalog.artifact, characterId, currentSequence) : null,
    [characterId, currentSequence, opened.catalog.artifact],
  )
  const graph = useMemo(
    () => characterId ? getSafeGraph(opened.catalog.artifact, characterId, currentSequence) : { nodes: [], edges: [] },
    [characterId, currentSequence, opened.catalog.artifact],
  )

  useEffect(() => {
    if (!open || !window.matchMedia('(max-width: 980px)').matches) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (document.activeElement instanceof HTMLElement && !panelRef.current?.contains(document.activeElement)) {
      returnFocusRef.current = document.activeElement
    }
    closeRef.current?.focus()
    return () => { document.body.style.overflow = previousOverflow }
  }, [open, characterId])

  const closeAndRestoreFocus = useCallback(() => {
    onClose()
    window.requestAnimationFrame(() => returnFocusRef.current?.focus())
  }, [onClose])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAndRestoreFocus()
      if (event.key !== 'Tab' || !window.matchMedia('(max-width: 980px)').matches) return
      const focusable = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    panel.addEventListener('keydown', onKeyDown)
    return () => panel.removeEventListener('keydown', onKeyDown)
  }, [closeAndRestoreFocus, open])

  const aliases = profile ? uniqueBy(profile.aliases, (fact) => fact.name.toLocaleLowerCase()) : []

  return (
    <>
      <div className={`dossier-scrim${open ? ' open' : ''}`} onClick={closeAndRestoreFocus} aria-hidden="true" />
      <aside ref={panelRef} className={`dossier${open ? ' open' : ''}`} aria-label="Known up to here character context">
        <div className="dossier-topline">
          <div><span className="micro-label">Known up to here</span><span><LockKeyhole size={12} aria-hidden="true" /> Through ¶ {currentSequence}</span></div>
          <button ref={closeRef} type="button" className="dossier-close" onClick={closeAndRestoreFocus} aria-label="Close character context"><X size={18} /></button>
        </div>
        {!profile ? (
          <div className="dossier-welcome">
            <div><UserRound size={25} aria-hidden="true" /></div>
            <h2>Select a name in the text</h2>
            <p>The dossier will contain only details established at this exact paragraph.</p>
          </div>
        ) : (
          <>
            <div className="profile-heading">
              <div className="profile-avatar" aria-hidden="true">{profile.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2)}</div>
              <div><p><span /> Reader-known character</p><h2>{profile.displayName}</h2></div>
            </div>
            <p className="profile-summary">{profile.summary}</p>
            <div className="profile-facts">
              <span><strong>{profile.observations.length}</strong> moments</span>
              <span><strong>{profile.relationships.length}</strong> connections</span>
              <span><strong>{aliases.length}</strong> names</span>
            </div>
            <div className="dossier-tabs" role="tablist" aria-label="Character context sections">
              <button type="button" role="tab" aria-selected={tab === 'timeline'} onClick={() => setTab('timeline')}><Clock3 size={14} /> Timeline</button>
              <button type="button" role="tab" aria-selected={tab === 'connections'} onClick={() => setTab('connections')}><Network size={14} /> Connections</button>
            </div>
            <div className="dossier-scroll" aria-live="polite">
              {tab === 'timeline' ? (
                <>
                  <section className="dossier-section">
                    <h3><UserRound size={14} aria-hidden="true" /> Known names</h3>
                    <div className="alias-list">
                      {aliases.map((fact) => <span key={fact.id}>{fact.name}<small>¶{fact.sourceSequence}</small></span>)}
                    </div>
                  </section>
                  <section className="dossier-section timeline-section">
                    <h3><Clock3 size={14} aria-hidden="true" /> Reader-known timeline</h3>
                    <ol>
                      {profile.observations.map((observation) => (
                        <li key={observation.id}>
                          <span className="timeline-dot" />
                          <div><span>{observation.kind} · ¶{observation.sourceSequence}</span><p>{observation.summary}</p></div>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <section className="dossier-section evidence-section">
                    <h3><Quote size={14} aria-hidden="true" /> Source on this device</h3>
                    {uniqueBy(
                      profile.observations.slice(-3).reverse().flatMap((observation) =>
                        observation.evidenceBlockIds.flatMap((id) => {
                          const source = opened.parsed.blocks.find((block) => block.id === id)
                          return source ? [source] : []
                        }),
                      ),
                      (source) => source.id,
                    ).slice(0, 3).map((source) => (
                      <blockquote key={source.id}><p>{source.text}</p><cite>Paragraph {source.sourceSequence}</cite></blockquote>
                    ))}
                  </section>
                </>
              ) : (
                <>
                  <section className="dossier-section graph-section">
                    <h3><Network size={14} aria-hidden="true" /> One-hop graph at ¶{currentSequence}</h3>
                    <RelationshipGraph graph={graph} />
                  </section>
                  <section className="dossier-section connection-list">
                    <h3>Established connections</h3>
                    {profile.relationships.length > 0 ? profile.relationships.map((relationship) => (
                      <div className="connection-row" key={relationship.id}>
                        <div>{relationship.relatedName.slice(0, 1)}</div>
                        <p><strong>{relationship.relatedName}</strong><span>{relationship.label}</span><small>{relationship.detail}</small></p>
                        <em>¶{relationship.sourceSequence}</em>
                      </div>
                    )) : <p className="empty-copy">No connections are established at this point.</p>}
                  </section>
                </>
              )}
            </div>
          </>
        )}
        <div className="dossier-footer"><ShieldCheck size={15} aria-hidden="true" /><p><strong>Spoiler boundary active</strong><span>Future records were filtered before this view was built.</span></p></div>
      </aside>
    </>
  )
}

function ReaderScreen({ active, onLibrary }: { active: ActiveReader; onLibrary: () => void }) {
  const { opened, initialSequence, settings } = active
  const initialChapter = chapterForSequence(opened.parsed, initialSequence)
  const [chapterId, setChapterId] = useState(initialChapter.id)
  const [currentSequence, setCurrentSequence] = useState(initialSequence)
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | undefined>(() =>
    opened.catalog.artifact.names
      .filter((record) => record.sourceSequence <= initialSequence)
      .sort((a, b) => b.sourceSequence - a.sourceSequence)[0]?.characterId,
  )
  const [dossierOpen, setDossierOpen] = useState(false)
  const currentChapter = opened.parsed.chapters.find((chapter) => chapter.id === chapterId) ?? opened.parsed.chapters[0]
  const readerRef = useRef<HTMLElement>(null)
  const frameRef = useRef<number>()
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

  const updateFromViewport = useCallback(() => {
    if (mentionBoundaryLockRef.current) return
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      const paragraphs = [...(readerRef.current?.querySelectorAll<HTMLElement>('.reader-block:not(.block-heading)[data-source-sequence]') ?? [])]
      const blocks = paragraphs.length > 0
        ? paragraphs
        : [...(readerRef.current?.querySelectorAll<HTMLElement>('[data-source-sequence]') ?? [])]
      if (blocks.length === 0) return
      const marker = window.innerHeight * 0.34
      const nearest = blocks.reduce((best, element) =>
        Math.abs(element.getBoundingClientRect().top - marker) < Math.abs(best.getBoundingClientRect().top - marker) ? element : best,
      )
      const sequence = Number(nearest.dataset.sourceSequence)
      if (Number.isFinite(sequence)) setCurrentSequence(sequence)
    })
  }, [])

  useEffect(() => {
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
    }
  }, [chapterId, updateFromViewport])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void saveReadingProgress({
        bookId: opened.catalog.id,
        chapterId,
        currentSequence,
        settings,
        updatedAt: new Date().toISOString(),
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [chapterId, currentSequence, opened.catalog.id, settings])

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

  const goToChapter = (chapter: EpubChapter) => {
    mentionBoundaryLockRef.current = false
    setChapterId(chapter.id)
    setCurrentSequence(chapter.firstSequence)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const chapterIndex = opened.parsed.chapters.findIndex((chapter) => chapter.id === currentChapter.id)
  const previousChapter = opened.parsed.chapters[chapterIndex - 1]
  const nextChapter = opened.parsed.chapters[chapterIndex + 1]
  const progress = Math.round((currentSequence / opened.parsed.maxSequence) * 100)

  return (
    <div
      className="reader-shell"
      style={{ '--reader-font-scale': settings.fontScale, '--reader-line-height': settings.lineHeight } as CSSProperties}
    >
      <header className="reader-topbar">
        <Brand onHome={onLibrary} />
        <div className="reader-title"><span>{opened.parsed.metadata.title}</span><i>/</i><span>{currentChapter.title}</span></div>
        <div className="reader-actions">
          <span className="safety-pill" aria-label={`Context is safe through paragraph ${currentSequence}`}><ShieldCheck size={14} /> Safe through ¶ {currentSequence}</span>
          <button type="button" className="mobile-dossier-button" onClick={() => setDossierOpen(true)} aria-label="Open character context"><Menu size={19} /></button>
        </div>
      </header>

      <aside className="chapter-rail" aria-label="Book navigation">
        <button type="button" className="back-library" onClick={onLibrary}><ArrowLeft size={14} /> Library</button>
        <BookCover book={opened.catalog} compact />
        <div className="rail-title"><span className="micro-label">Reading now</span><h2>{opened.parsed.metadata.title}</h2><p>{opened.parsed.metadata.author}</p></div>
        <nav className="chapter-list" aria-label="Chapters">
          <span className="micro-label">Contents</span>
          {opened.parsed.chapters.map((chapter, index) => (
            <button
              type="button"
              key={chapter.id}
              className={chapter.id === currentChapter.id ? 'active' : ''}
              aria-current={chapter.id === currentChapter.id ? 'page' : undefined}
              onClick={() => goToChapter(chapter)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span><strong>{chapter.title}</strong><ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="rail-progress"><div><span className="micro-label">Book progress</span><strong>{progress}%</strong></div><span><i style={{ width: `${progress}%` }} /></span><small>¶ {currentSequence} of {opened.parsed.maxSequence}</small></div>
      </aside>

      <main ref={readerRef} className="reader-main" id="reader">
        <div className="reading-marker" aria-hidden="true"><span>Reading here</span></div>
        <header className="chapter-heading"><span>Section {chapterIndex + 1}</span><h1>{currentChapter.title}</h1><div>✦</div></header>
        <div className="chapter-body">
          {currentChapter.blocks.map((block) => {
            const current = block.sourceSequence === currentSequence
            if (block.kind === 'heading') {
              return <h2 key={block.id} id={block.id} className={`reader-block block-heading${current ? ' current' : ''}`} data-source-sequence={block.sourceSequence}>{block.text}</h2>
            }
            return (
              <div key={block.id} id={block.id} className={`reader-block${current ? ' current' : ''}`} data-source-sequence={block.sourceSequence}>
                <span className="paragraph-number" aria-hidden="true">{block.sourceSequence}</span>
                <p><MentionedText block={block} mentions={mentionsByBlock.get(block.id) ?? []} selectedCharacterId={selectedCharacterId} onSelect={selectCharacter} /></p>
              </div>
            )
          })}
        </div>
        <nav className="chapter-pager" aria-label="Adjacent chapters">
          {previousChapter ? <button type="button" onClick={() => goToChapter(previousChapter)}><ChevronLeft size={16} /><span>Previous<strong>{previousChapter.title}</strong></span></button> : <span />}
          {nextChapter ? <button type="button" onClick={() => goToChapter(nextChapter)}><span>Next<strong>{nextChapter.title}</strong></span><ChevronRight size={16} /></button> : <span />}
        </nav>
      </main>

      <CharacterDossier opened={opened} characterId={selectedCharacterId} currentSequence={currentSequence} open={dossierOpen} onClose={() => setDossierOpen(false)} />
      <div className="floating-position"><button type="button" disabled={!previousChapter} onClick={() => previousChapter && goToChapter(previousChapter)} aria-label="Previous chapter"><ChevronLeft size={16} /></button><span><strong>¶ {currentSequence}</strong> · {progress}%</span><button type="button" disabled={!nextChapter} onClick={() => nextChapter && goToChapter(nextChapter)} aria-label="Next chapter"><ChevronRight size={16} /></button></div>
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
