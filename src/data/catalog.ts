import { assertValidArtifact } from '../lib/artifact'
import type { PreparedBook } from '../types'
import aliceArtifactJson from './artifacts/alice.json'
import frankensteinArtifactJson from './artifacts/frankenstein.json'
import neuromancerArtifactJson from './artifacts/neuromancer.json'

const aliceArtifact = assertValidArtifact(aliceArtifactJson)
const frankensteinArtifact = assertValidArtifact(frankensteinArtifactJson)
const neuromancerArtifact = assertValidArtifact(neuromancerArtifactJson)

export const preparedBooks: PreparedBook[] = [
  {
    id: 'alice',
    title: 'Alice’s Adventures in Wonderland',
    author: 'Lewis Carroll',
    description: 'A prepared Standard Ebooks edition with paragraph-linked character context and local evidence.',
    fingerprint: 'ee036cd4da21ea84aa9f17cbdd75a476e1f69ee5f51136ef5469e85b008fe17d',
    publicPath: 'books/alice.epub',
    license: 'CC0',
    coverTone: 'sage',
    artifact: aliceArtifact,
  },
  {
    id: 'frankenstein',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    description: 'A prepared Standard Ebooks edition with paragraph-linked character context and local evidence.',
    fingerprint: '9ef7e1a6138d8bf64e6c529e6c981a169a70f7455455598aba031da482ec6c8f',
    publicPath: 'books/frankenstein.epub',
    license: 'CC0',
    coverTone: 'wine',
    artifact: frankensteinArtifact,
  },
  {
    id: 'neuromancer',
    title: 'Neuromancer',
    author: 'William Gibson',
    description: 'A local-only prepared edition. Upload your own matching EPUB on the public demo.',
    fingerprint: '0366da0b0f1c495b8bbda96c96cb91801bc2c7a7f82a7ec2049b87ef8d2a5ebf',
    publicPath: 'books/neuromancer.epub',
    license: 'CC0',
    coverTone: 'electric',
    artifact: neuromancerArtifact,
  },
]

export const publicBooks = preparedBooks

export const preparedBookByFingerprint = (fingerprint: string) =>
  preparedBooks.find((book) => book.fingerprint === fingerprint)

export const preparedBookById = (bookId: string) =>
  preparedBooks.find((book) => book.id === bookId)
