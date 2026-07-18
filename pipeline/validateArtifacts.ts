import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validateArtifact } from '../src/lib/artifact'
import { parseEpub } from '../src/lib/epub'
import { writeQaReport } from './qa'

const bookIds = ['alice', 'frankenstein', 'neuromancer']
let failed = false

for (const bookId of bookIds) {
  try {
    const [epub, artifactRaw] = await Promise.all([
      readFile(resolve(`public/books/${bookId}.epub`)),
      readFile(resolve(`src/data/artifacts/${bookId}.json`), 'utf8'),
    ])
    const book = await parseEpub(epub)
    const result = validateArtifact(JSON.parse(artifactRaw), book)
    if (result.artifact) {
      await writeQaReport(resolve(`.highlighter-work/${bookId}/qa.html`), book, result.artifact, result.issues)
    }
    if (result.issues.length > 0) throw new Error(result.issues.join('\n'))
    process.stdout.write(`${bookId}: valid\n`)
  } catch (error) {
    failed = true
    process.stderr.write(`${bookId}: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

if (failed) process.exitCode = 1
