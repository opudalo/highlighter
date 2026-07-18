# Highlighter repository guide

## Product invariant

No character context, relationship, event, status, alias, or summary sentence may depend on source text after the reader's current canonical position.

Every story-derived datum must carry a stable `sourceSequence`. UI selectors must filter records with:

```ts
record.sourceSequence <= reader.currentSequence
```

Do not rely on visually hiding future data after it has been assembled. Filter it before creating the view model.

## Commands

- Install dependencies: `pnpm install`
- Run locally: `pnpm dev`
- Type-check: `pnpm typecheck`
- Test: `pnpm test`
- Production build: `pnpm build`
- Full verification: `pnpm check`

## Conventions

- Use TypeScript for application and test code.
- Keep checked processed artifacts in `src/data/artifacts/` and book metadata in `src/data/catalog.ts`.
- Keep spoiler-boundary selection logic in `src/lib/spoilerSafe.ts` and test it independently of React.
- Character names in the text must be keyboard-operable buttons, not links or styled spans.
- Preserve stable paragraph sequence numbers when editing prose.
- Prefer semantic HTML and visible focus styles.
- The browser app has no runtime model, backend, database server, or authentication dependency.
- Never commit `public/books/neuromancer.epub` or `.highlighter-work/` QA reports.
- Production EPUB copying must remain an explicit allowlist.

## Completion criteria

Before claiming a task is complete, run `pnpm check`. For changes to the reader interaction or layout, also verify the app in a browser at desktop and narrow viewport widths.
