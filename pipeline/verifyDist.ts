import { readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const booksDirectory = resolve('dist/books')
const files = (await readdir(booksDirectory)).sort()
const expected = ['alice.epub', 'frankenstein.epub']

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(`Production EPUB allowlist failed. Found: ${files.join(', ') || 'none'}`)
}

for (const filename of files) {
  const details = await stat(resolve(booksDirectory, filename))
  if (!details.isFile() || details.size < 10_000) throw new Error(`${filename} is not a valid production book asset.`)
}

process.stdout.write('Production EPUB allowlist verified.\n')
