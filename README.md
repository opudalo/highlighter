# Highlighter

Highlighter is a local-first, spoiler-safe fiction reader. It parses EPUB files in the browser and reveals character context only from sources at or before the paragraph currently being read.

## Demo

[Open the GitHub Pages demo](https://opudalo.github.io/highlighter/).

The public build includes the Standard Ebooks editions of *Alice’s Adventures in Wonderland* and *Frankenstein*. A prepared local edition of *Neuromancer* is supported by exact fingerprint, but the copyrighted EPUB is ignored and never included in a production build.

```sh
pnpm install
pnpm dev
```

The browser never uploads an imported book. Imported files and reading positions are stored in IndexedDB on the current device.

## Preprocessing

The offline extraction pipeline runs strictly forward through canonical EPUB blocks. It uses subscription-authenticated Codex CLI first, validates every response against the same structured schema, checkpoints accepted chunks, and can fall back to Claude CLI.

```sh
pnpm ingest --book alice --provider codex --fallback claude
pnpm ingest --book frankenstein --provider codex --fallback claude
pnpm ingest --book neuromancer --provider codex --fallback claude
```

Raw text, checkpoints, and source-bearing QA reports stay under `.highlighter-work/` and are ignored. Reviewed overrides live under `pipeline/overrides/`. The generated public artifact contains derived, source-positioned records but no source prose.

For a fast deterministic fallback, `pnpm bootstrap:artifacts` regenerates the reviewed demo artifacts without a model call.

## Safety model

Every story-derived datum has a stable `sourceSequence` and `sourceBlockId`. Names, aliases, observations, relationships, summary snapshots, and graph nodes are filtered independently before the reader view model is assembled:

```ts
record.sourceSequence <= reader.currentSequence
```

The app does not assemble future data and then hide it with CSS.

## Verification and deployment

```sh
pnpm check
pnpm validate:artifacts # requires all three local EPUB files
```

The production Vite build uses an explicit EPUB allowlist. Only Alice and Frankenstein can enter `dist/books`; a verification step fails the build if any other EPUB appears. GitHub Pages deploys only after type-checking, tests, production build, and this rights-safety check pass.

## Book sources

The Alice and Frankenstein EPUBs are produced by [Standard Ebooks](https://standardebooks.org/), which dedicates its complete ebook files to the public domain via CC0. See [Standard Ebooks and the Public Domain](https://standardebooks.org/about/standard-ebooks-and-the-public-domain).
