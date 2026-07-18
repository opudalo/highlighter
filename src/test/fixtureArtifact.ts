import type { ProcessedBookArtifact } from '../types'

export const fixtureArtifact: ProcessedBookArtifact = {
  schemaVersion: 1,
  promptVersion: 'test-v1',
  bookId: 'fixture',
  fingerprint: 'a'.repeat(64),
  generatedAt: '2026-07-18T00:00:00.000Z',
  sourceBlockCount: 8,
  entities: [{ id: 'c-mara' }, { id: 'c-elias' }, { id: 'c-keeper' }],
  names: [
    { id: 'name-mara-2', characterId: 'c-mara', name: 'Mara', kind: 'name', sourceSequence: 2, sourceBlockId: 'chapter-1-block-2' },
    { id: 'name-gray-2', characterId: 'c-elias', name: 'Mr Gray', kind: 'alias', sourceSequence: 2, sourceBlockId: 'chapter-1-block-2' },
    { id: 'name-keeper-6', characterId: 'c-keeper', name: 'The Keeper', kind: 'title', sourceSequence: 6, sourceBlockId: 'chapter-2-block-2' },
    { id: 'name-elias-7', characterId: 'c-elias', name: 'Elias', kind: 'name', sourceSequence: 7, sourceBlockId: 'chapter-2-block-3' },
  ],
  mentions: [
    { id: 'mention-mara-2', characterId: 'c-mara', sourceSequence: 2, sourceBlockId: 'chapter-1-block-2', startOffset: 0, endOffset: 4 },
    { id: 'mention-gray-2', characterId: 'c-elias', sourceSequence: 2, sourceBlockId: 'chapter-1-block-2', startOffset: 9, endOffset: 16 },
  ],
  observations: [
    { id: 'obs-elias-2', characterId: 'c-elias', kind: 'Introduction', summary: 'A guarded man met at the gate.', evidenceBlockIds: ['chapter-1-block-2'], sourceSequence: 2, sourceBlockId: 'chapter-1-block-2' },
    { id: 'obs-elias-7', characterId: 'c-elias', kind: 'Revelation', summary: 'Mr Gray reveals that his name is Elias.', evidenceBlockIds: ['chapter-2-block-3'], sourceSequence: 7, sourceBlockId: 'chapter-2-block-3' },
    { id: 'obs-elias-8', characterId: 'c-elias', kind: 'Relationship', summary: 'Elias identifies the Keeper as his father.', evidenceBlockIds: ['chapter-2-block-4'], sourceSequence: 8, sourceBlockId: 'chapter-2-block-4' },
  ],
  relationships: [
    { id: 'rel-elias-keeper-8', fromCharacterId: 'c-elias', toCharacterId: 'c-keeper', label: 'son', detail: 'Elias calls the Keeper his father.', state: 'starts', sourceSequence: 8, sourceBlockId: 'chapter-2-block-4' },
  ],
  summaries: [
    { id: 'summary-elias-2', characterId: 'c-elias', summary: 'A guarded man met at the gate.', inputRecordIds: ['obs-elias-2'], sourceSequence: 2, sourceBlockId: 'chapter-1-block-2' },
    { id: 'summary-elias-8', characterId: 'c-elias', summary: 'Elias is revealed as the Keeper’s son.', inputRecordIds: ['obs-elias-2', 'obs-elias-7', 'obs-elias-8', 'rel-elias-keeper-8'], sourceSequence: 8, sourceBlockId: 'chapter-2-block-4' },
  ],
}
