import react from '@vitejs/plugin-react'
import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const productionBookAllowlist = ['alice.epub', 'frankenstein.epub']

const rightsSafePublicAssets = (): Plugin => ({
  name: 'rights-safe-public-assets',
  apply: 'build',
  async writeBundle(options) {
    const outputDirectory = resolve(String(options.dir ?? 'dist'))
    const booksDirectory = resolve(outputDirectory, 'books')
    await mkdir(booksDirectory, { recursive: true })
    await Promise.all(productionBookAllowlist.map((filename) =>
      copyFile(resolve('public', 'books', filename), resolve(booksDirectory, filename)),
    ))
  },
})

export default defineConfig(({ command }) => ({
  base: './',
  publicDir: command === 'serve' ? 'public' : false,
  plugins: [react(), rightsSafePublicAssets()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
}))
