# SPOIL NOT

SPOIL NOT is a local-first, spoiler-safe EPUB reader. A reader can activate a character name and see only what the source has established at the exact visible paragraph.

## Hackathon MVP

- Parse EPUB 2/3 packages in the browser without executing book HTML, CSS, scripts, or remote resources.
- Read prepared Standard Ebooks editions of *Alice’s Adventures in Wonderland* and *Frankenstein*.
- Use a matching local copy of *Neuromancer* during development or upload it on the public build.
- Persist imported EPUB blobs and reading state in IndexedDB.
- Show source-linked character summaries, aliases, observations, evidence, and one-hop relationships.
- Generate derived artifacts offline with resumable, schema-constrained Codex CLI calls and Claude CLI fallback.
- Deploy a rights-safe build to GitHub Pages with an explicit EPUB allowlist.

## Safety model

Every story-derived record carries `sourceSequence` and `sourceBlockId`. Selectors filter every sourced collection at `sourceSequence <= currentSequence` before constructing a profile or graph. Clicking a name moves the boundary to that exact source block; scrolling backward shrinks it again.

Character entities are opaque IDs. A display name exists only when an eligible source-positioned name fact exists. Published Neuromancer data contains derived paraphrases and offsets, never its source prose or QA excerpts.
