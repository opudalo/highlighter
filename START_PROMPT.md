# Highlighter continuation prompt

Read `AGENTS.md`, `PROJECT.md`, and `README.md` completely before changing the app.

Preserve the central invariant: every story-derived collection must be filtered to `sourceSequence <= currentSequence` before any profile, summary, evidence list, or graph view model is constructed. Never publish `public/books/neuromancer.epub` or a QA report containing its source excerpts.

Run `pnpm check` for every completed change. For reader interactions or layout changes, also verify the live app in a desktop and narrow browser viewport.
