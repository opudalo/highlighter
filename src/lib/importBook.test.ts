import { describe, expect, it } from 'vitest'
import { preparedBookByFingerprint, publicBooks } from '../data/catalog'

describe('prepared edition matching', () => {
  it('matches Neuromancer only by its exact prepared fingerprint', () => {
    const expected = '0366da0b0f1c495b8bbda96c96cb91801bc2c7a7f82a7ec2049b87ef8d2a5ebf'
    expect(preparedBookByFingerprint(expected)?.id).toBe('neuromancer')
    expect(preparedBookByFingerprint(expected.replace(/^0/, '1'))).toBeUndefined()
  })

  it('publishes only the two rights-safe prepared editions', () => {
    expect(publicBooks.map((book) => book.id)).toEqual(['alice', 'frankenstein'])
  })
})
