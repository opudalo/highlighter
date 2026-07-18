import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createTestEpub } from './test/epubFixture'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SPOIL NOT landing page', () => {
  it('briefly explains the product and offers three trial books', () => {
    render(<App />)
    expect(screen.getByRole('img', { name: 'SPOIL NOT' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Ever read a book/i })).toBeInTheDocument()
    expect(screen.getByText('Yeah, me too.')).toBeInTheDocument()
    expect(screen.getByText(/page 10 and page 100/i)).toBeInTheDocument()
    expect(screen.getByText(/click any underlined character name/i)).toBeInTheDocument()
    expect(screen.getByLabelText('A character name is clicked, opening spoiler-safe context')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Read Alice’s Adventures in Wonderland' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read Frankenstein' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open an EPUB' })).toBeInTheDocument()
    expect(document.querySelectorAll('.trial-book-thumbnail')).toHaveLength(3)
  })

  it('waits 30 seconds before offering prepared books for an unknown EPUB', async () => {
    vi.useFakeTimers()
    render(<App />)
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File([createTestEpub('Unknown Book')], 'unknown.epub', { type: 'application/epub+zip' })
    fireEvent.change(input, { target: { files: [file] } })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByRole('dialog', { name: 'Preparing EPUB' })).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(29_900); await Promise.resolve() })
    expect(screen.queryByText(/machines are too tired/i)).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve() })
    expect(screen.getByText(/machines are too tired/i)).toBeInTheDocument()
  })
})

describe('SPOIL NOT reader', () => {
  it('opens a real prepared EPUB and exposes keyboard-operable character context', async () => {
    const bytes = await readFile(resolve('public/books/alice.epub'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))
    const user = userEvent.setup()
    render(<App />)
    const aliceCard = screen.getByRole('heading', { name: 'Alice’s Adventures in Wonderland' }).closest('article')!
    await user.click(within(aliceCard).getByRole('button', { name: 'Read Alice’s Adventures in Wonderland' }))
    await waitFor(() => expect(screen.getByRole('main')).toHaveClass('reader-main'), { timeout: 10_000 })

    let nearestSequence = 3
    const rectangle = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const sequence = Number(this.dataset.sourceSequence)
      const top = Number.isFinite(sequence)
        ? window.innerHeight * 0.34 + (sequence - nearestSequence) * 100
        : 0
      return { x: 0, y: top, top, left: 0, right: 0, bottom: top, width: 0, height: 0, toJSON: () => ({}) }
    })
    fireEvent.scroll(window)
    await waitFor(() => expect(screen.getByLabelText(/safe through paragraph 3/i)).toBeInTheDocument())
    nearestSequence = 6
    fireEvent.scroll(window)
    await waitFor(() => expect(screen.getByLabelText(/safe through paragraph 6/i)).toBeInTheDocument())

    expect(screen.getByRole('heading', { level: 2, name: 'I' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next chapter' })).not.toBeInTheDocument()

    const nameButton = await screen.findByRole('button', { name: 'Open Alice character context at paragraph 7' })
    fireEvent.pointerEnter(nameButton, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument(), { timeout: 1_000 })
    expect(within(screen.getByRole('tooltip')).queryByRole('heading')).not.toBeInTheDocument()
    fireEvent.pointerLeave(nameButton, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    nameButton.focus()
    await user.keyboard('{Enter}')
    const dossier = screen.getByRole('complementary', { name: 'Known up to here character context' })
    expect(within(dossier).getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
    expect(within(dossier).queryByText('Reader-known character')).not.toBeInTheDocument()
    expect(within(dossier).queryByText('Spoiler boundary active')).not.toBeInTheDocument()
    expect(within(dossier).getByText('No timeline moments yet.')).toBeInTheDocument()
    expect(within(dossier).queryByRole('tab', { name: 'Story so far' })).not.toBeInTheDocument()
    expect(within(dossier).queryByText(/^¶/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/safe through paragraph 7/i)).toBeInTheDocument()
    await user.click(within(dossier).getByRole('tab', { name: 'Connections' }))
    expect(within(dossier).getByText(/No connections yet/i)).toBeInTheDocument()
    fireEvent.scroll(window)
    expect(screen.getByLabelText(/safe through paragraph 7/i)).toBeInTheDocument()
    fireEvent.wheel(window)
    fireEvent.scroll(window)
    await waitFor(() => expect(screen.getByLabelText(/safe through paragraph 6/i)).toBeInTheDocument())
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    await user.click(screen.getByRole('button', { name: /Open contents/i }))
    expect(dossier).not.toHaveClass('open')
    await user.click(within(screen.getByRole('navigation', { name: 'Chapters' })).getByRole('button', { name: /^I Estimated page/i }))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' }))
    rectangle.mockRestore()
  }, 20_000)

  it('opens full context inline and navigates through clickable connections', async () => {
    const bytes = await readFile(resolve('public/books/alice.epub'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))
    const user = userEvent.setup()
    render(<App />)
    const aliceCard = screen.getByRole('heading', { name: 'Alice’s Adventures in Wonderland' }).closest('article')!
    await user.click(within(aliceCard).getByRole('button', { name: 'Read Alice’s Adventures in Wonderland' }))
    const aliceMentions = await screen.findAllByRole('button', { name: 'Open Alice character context at paragraph 12' })
    await user.click(aliceMentions[0])

    const dossier = screen.getByRole('complementary', { name: 'Known up to here character context' })
    await user.click(within(dossier).getByRole('button', { name: 'Read full context' }))
    const fullContext = dossier.querySelector<HTMLElement>('.full-context-section')!
    expect(within(fullContext).getByText(/Alice sees little value in books without pictures/i)).toBeInTheDocument()
    expect(dossier.querySelector('.profile-summary')).not.toBeInTheDocument()
    expect(within(dossier).queryByRole('tab', { name: 'Timeline' })).not.toBeInTheDocument()
    await user.click(within(dossier).getByRole('button', { name: 'Read short summary' }))
    expect(dossier.querySelector('.profile-summary')).toBeInTheDocument()
    expect(dossier.querySelector('.full-context-section')).not.toBeInTheDocument()

    await user.click(within(dossier).getByRole('tab', { name: 'Connections' }))
    const whiteRabbit = within(dossier).getByRole('button', { name: /White Rabbit/i })
    await user.click(whiteRabbit)
    await waitFor(() => expect(within(dossier).getByRole('heading', { name: 'Rabbit' })).toBeInTheDocument())
    expect(within(dossier).getByText(/also “White Rabbit”/i)).toBeInTheDocument()
    expect(within(dossier).getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true')
  }, 20_000)

  it('moves focus into the narrow character sheet and closes it with Escape', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query.includes('max-width: 1250px'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }))
    const bytes = await readFile(resolve('public/books/alice.epub'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))
    const user = userEvent.setup()
    render(<App />)
    const aliceCard = screen.getByRole('heading', { name: 'Alice’s Adventures in Wonderland' }).closest('article')!
    await user.click(within(aliceCard).getByRole('button', { name: 'Read Alice’s Adventures in Wonderland' }))
    const nameButton = await screen.findByRole('button', { name: 'Open Alice character context at paragraph 7' })
    await user.click(nameButton)
    const close = screen.getByRole('button', { name: 'Close character context' })
    const sheet = screen.getByRole('complementary', { name: 'Known up to here character context' })
    await waitFor(() => expect(close).toHaveFocus())
    expect(sheet).toHaveClass('open')
    await user.keyboard('{Escape}')
    expect(sheet).not.toHaveClass('open')
    await waitFor(() => expect(nameButton).toHaveFocus())
  }, 20_000)
})
