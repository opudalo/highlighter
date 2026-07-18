import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { locateMentions, validateArtifact } from '../src/lib/artifact'
import { parseEpub } from '../src/lib/epub'
import type { BookId, NameFact, Observation, ProcessedBookArtifact, RelationshipEvent, SummarySnapshot } from '../src/types'

type SeedCharacter = {
  id: string
  names: Array<{ value: string; kind?: NameFact['kind'] }>
  introduction: string
}

type SeedBook = {
  id: BookId
  characters: SeedCharacter[]
  relationships: Array<{
    from: string
    to: string
    label: string
    detail: string
    sharedNames: [string, string]
  }>
}

const seeds: SeedBook[] = [
  {
    id: 'alice',
    characters: [
      { id: 'c-alice', names: [{ value: 'Alice' }], introduction: 'A curious girl whose pursuit of something extraordinary draws her into Wonderland.' },
      { id: 'c-white-rabbit', names: [{ value: 'White Rabbit' }, { value: 'Rabbit', kind: 'alias' }], introduction: 'An anxious, hurried rabbit whose appearance catches Alice’s attention.' },
      { id: 'c-mouse', names: [{ value: 'Mouse' }, { value: 'the Mouse', kind: 'title' }], introduction: 'A talking mouse Alice encounters after her arrival in Wonderland.' },
      { id: 'c-duchess', names: [{ value: 'Duchess' }, { value: 'the Duchess', kind: 'title' }], introduction: 'A volatile resident of Wonderland whom Alice meets during her journey.' },
      { id: 'c-cheshire-cat', names: [{ value: 'Cheshire Cat' }, { value: 'Cat', kind: 'alias' }], introduction: 'A grinning cat who offers Alice cryptic guidance.' },
      { id: 'c-hatter', names: [{ value: 'Hatter' }, { value: 'the Hatter', kind: 'title' }], introduction: 'An eccentric participant in a perpetually unsettled tea party.' },
      { id: 'c-queen', names: [{ value: 'Queen of Hearts' }, { value: 'Queen', kind: 'title' }], introduction: 'Wonderland’s imperious queen, quick to demand punishment.' },
    ],
    relationships: [
      { from: 'c-alice', to: 'c-white-rabbit', label: 'follows', detail: 'The White Rabbit’s hurried appearance draws Alice onward.', sharedNames: ['Alice', 'White Rabbit'] },
      { from: 'c-alice', to: 'c-cheshire-cat', label: 'seeks guidance from', detail: 'Alice turns to the Cheshire Cat for help navigating Wonderland.', sharedNames: ['Alice', 'Cheshire Cat'] },
      { from: 'c-alice', to: 'c-queen', label: 'challenged by', detail: 'Alice must contend with the Queen of Hearts’ authority.', sharedNames: ['Alice', 'Queen'] },
    ],
  },
  {
    id: 'frankenstein',
    characters: [
      { id: 'c-walton', names: [{ value: 'Walton' }, { value: 'Robert Walton', kind: 'name' }], introduction: 'An ambitious Arctic explorer whose letters frame the account.' },
      { id: 'c-victor', names: [{ value: 'Victor' }, { value: 'Frankenstein', kind: 'name' }], introduction: 'A gifted young man driven by an intense pursuit of natural philosophy.' },
      { id: 'c-elizabeth', names: [{ value: 'Elizabeth' }, { value: 'Elizabeth Lavenza', kind: 'name' }], introduction: 'Victor’s beloved childhood companion and a central member of his family.' },
      { id: 'c-clerval', names: [{ value: 'Clerval' }, { value: 'Henry Clerval', kind: 'name' }], introduction: 'Victor’s loyal friend, animated by humane and literary ambitions.' },
      { id: 'c-creature', names: [{ value: 'creature' }, { value: 'the monster', kind: 'alias' }], introduction: 'A living being brought into the world through Victor’s experiment.' },
    ],
    relationships: [
      { from: 'c-victor', to: 'c-elizabeth', label: 'family companions', detail: 'Victor and Elizabeth are raised together in a close family bond.', sharedNames: ['Victor', 'Elizabeth'] },
      { from: 'c-victor', to: 'c-clerval', label: 'friends', detail: 'Clerval is Victor’s steadfast childhood friend.', sharedNames: ['Victor', 'Clerval'] },
      { from: 'c-victor', to: 'c-creature', label: 'creator and creation', detail: 'Victor’s experiment brings the creature to life.', sharedNames: ['Victor', 'creature'] },
    ],
  },
  {
    id: 'neuromancer',
    characters: [
      { id: 'c-case', names: [{ value: 'Case' }], introduction: 'A damaged console cowboy surviving on the margins of Chiba City.' },
      { id: 'c-molly', names: [{ value: 'Molly' }], introduction: 'A formidable street samurai with mirrored lenses and a precise manner.' },
      { id: 'c-armitage', names: [{ value: 'Armitage' }], introduction: 'The controlled and mysterious organizer behind a dangerous new job.' },
      { id: 'c-linda-lee', names: [{ value: 'Linda Lee' }, { value: 'Linda', kind: 'alias' }], introduction: 'A young woman from Case’s life in Chiba City.' },
      { id: 'c-wintermute', names: [{ value: 'Wintermute' }], introduction: 'A powerful intelligence whose role emerges through the unfolding operation.' },
    ],
    relationships: [
      { from: 'c-case', to: 'c-molly', label: 'operational partners', detail: 'Case and Molly are brought together for the same operation.', sharedNames: ['Case', 'Molly'] },
      { from: 'c-case', to: 'c-armitage', label: 'recruited by', detail: 'Armitage recruits Case for an operation with carefully controlled terms.', sharedNames: ['Case', 'Armitage'] },
      { from: 'c-case', to: 'c-linda-lee', label: 'past connection', detail: 'Linda Lee is part of Case’s troubled life in Chiba City.', sharedNames: ['Case', 'Linda'] },
    ],
  },
]

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsName = (text: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text)

for (const seed of seeds) {
  const book = await parseEpub(await readFile(resolve(`public/books/${seed.id}.epub`)))
  const names: NameFact[] = []
  const observations: Observation[] = []
  const summaries: SummarySnapshot[] = []
  const relationships: RelationshipEvent[] = []

  for (const character of seed.characters) {
    for (const [nameIndex, configured] of character.names.entries()) {
      const block = book.blocks.find((item) => containsName(item.text, configured.value))
      if (!block) continue
      names.push({
        id: `name-${character.id}-${block.sourceSequence}-${nameIndex + 1}`,
        characterId: character.id,
        name: configured.value,
        kind: configured.kind ?? 'name',
        sourceSequence: block.sourceSequence,
        sourceBlockId: block.id,
      })
    }
    const firstName = names.filter((record) => record.characterId === character.id).sort((a, b) => a.sourceSequence - b.sourceSequence)[0]
    if (!firstName) continue
    const safeIntroduction = `${firstName.name} is explicitly named at this point in the text.`
    const observation: Observation = {
      id: `obs-${character.id}-${firstName.sourceSequence}-introduction`,
      characterId: character.id,
      kind: 'Introduction',
      summary: safeIntroduction,
      evidenceBlockIds: [firstName.sourceBlockId],
      sourceSequence: firstName.sourceSequence,
      sourceBlockId: firstName.sourceBlockId,
    }
    observations.push(observation)
    summaries.push({
      id: `summary-${character.id}-${firstName.sourceSequence}`,
      characterId: character.id,
      summary: safeIntroduction,
      inputRecordIds: [observation.id],
      sourceSequence: firstName.sourceSequence,
      sourceBlockId: firstName.sourceBlockId,
    })
  }

  for (const [index, configured] of seed.relationships.entries()) {
    const block = book.blocks.find((item) => configured.sharedNames.every((name) => containsName(item.text, name)))
    if (!block) continue
    relationships.push({
      id: `rel-${configured.from}-${configured.to}-${block.sourceSequence}-${index + 1}`,
      fromCharacterId: configured.from,
      toCharacterId: configured.to,
      label: 'appears with',
      detail: `${configured.sharedNames[0]} and ${configured.sharedNames[1]} are explicitly named in the same source block.`,
      state: 'starts',
      sourceSequence: block.sourceSequence,
      sourceBlockId: block.id,
    })
  }

  const artifact: ProcessedBookArtifact = {
    schemaVersion: 1,
    promptVersion: 'bootstrap-reviewed-v1',
    bookId: seed.id,
    fingerprint: book.fingerprint,
    generatedAt: '1970-01-01T00:00:00.000Z',
    sourceBlockCount: book.maxSequence,
    entities: seed.characters.map((character) => ({ id: character.id })),
    names,
    mentions: [],
    observations,
    relationships,
    summaries,
  }
  artifact.mentions = locateMentions(book, artifact)
  const validation = validateArtifact(artifact, book)
  if (validation.issues.length > 0) throw new Error(`${seed.id}: ${validation.issues.join('\n')}`)
  await mkdir(resolve('src/data/artifacts'), { recursive: true })
  await writeFile(resolve(`src/data/artifacts/${seed.id}.json`), `${JSON.stringify(artifact, null, 2)}\n`)
  process.stdout.write(`${seed.id}: ${artifact.entities.length} characters, ${artifact.mentions.length} mentions\n`)
}
