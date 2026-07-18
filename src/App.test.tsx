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

describe('Highlighter library', () => {
  it('offers prepared books and explains the local privacy boundary', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /Every character/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Alice’s Adventures in Wonderland' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Frankenstein' })).toBeInTheDocument()
    expect(screen.getAllByText(/Books stay on this device/i).length).toBeGreaterThan(0)
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

describe('Highlighter reader', () => {
  it('opens a real prepared EPUB and exposes keyboard-operable character context', async () => {
    const bytes = await readFile(resolve('public/books/alice.epub'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200 })))
    const user = userEvent.setup()
    render(<App />)
    const aliceCard = screen.getByRole('heading', { name: 'Alice’s Adventures in Wonderland' }).closest('article')!
    await user.click(within(aliceCard).getByRole('button', { name: 'Read now' }))
    await waitFor(() => expect(screen.getByRole('main')).toHaveClass('reader-main'), { timeout: 10_000 })

    let nearestSequence = 3
    const rectangle = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const sequence = Number(this.dataset.sourceSequence)
      const top = sequence === nearestSequence ? window.innerHeight * 0.34 : 1_000 + (Number.isFinite(sequence) ? sequence : 0)
      return { x: 0, y: top, top, left: 0, right: 0, bottom: top, width: 0, height: 0, toJSON: () => ({}) }
    })
    fireEvent.scroll(window)
    await waitFor(() => expect(screen.getByLabelText(/safe through paragraph 3/i)).toBeInTheDocument())
    nearestSequence = 6
    fireEvent.scroll(window)
    await waitFor(() => expect(screen.getByLabelText(/safe through paragraph 6/i)).toBeInTheDocument())

    const nameButton = await screen.findByRole('button', { name: /Open Alice character context/i })
    nameButton.focus()
    await user.keyboard('{Enter}')
    const dossier = screen.getByRole('complementary', { name: 'Known up to here character context' })
    expect(within(dossier).getByRole('heading', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByLabelText(/safe through paragraph 7/i)).toBeInTheDocument()
    await user.click(within(dossier).getByRole('tab', { name: 'Connections' }))
    expect(within(dossier).getByText(/No reader-known connections/i)).toBeInTheDocument()
    fireEvent.scroll(window)
    expect(screen.getByLabelText(/safe through paragraph 7/i)).toBeInTheDocument()
    fireEvent.wheel(window)
    fireEvent.scroll(window)
    await waitFor(() => expect(screen.getByLabelText(/safe through paragraph 6/i)).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Next chapter' }))
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'I' })).toBeInTheDocument())
    rectangle.mockRestore()
  }, 20_000)

  it('moves focus into the narrow character sheet and closes it with Escape', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query.includes('max-width: 980px'),
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
    await user.click(within(aliceCard).getByRole('button', { name: 'Read now' }))
    const nameButton = await screen.findByRole('button', { name: /Open Alice character context/i })
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
