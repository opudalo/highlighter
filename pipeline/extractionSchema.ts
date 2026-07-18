import { z } from 'zod'

const sourced = {
  sourceSequence: z.number().int().positive(),
  sourceBlockId: z.string().min(1),
}

export const chunkExtractionSchema = z.object({
  entities: z.array(z.object({ id: z.string().min(1) })),
  names: z.array(z.object({
    id: z.string().min(1),
    characterId: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['name', 'alias', 'title']),
    ...sourced,
  })),
  observations: z.array(z.object({
    id: z.string().min(1),
    characterId: z.string().min(1),
    kind: z.enum(['Introduction', 'Attribute', 'Action', 'Relationship', 'Location', 'Goal', 'Revelation', 'Status']),
    summary: z.string().min(1),
    evidenceBlockIds: z.array(z.string().min(1)).min(1),
    ...sourced,
  })),
  relationships: z.array(z.object({
    id: z.string().min(1),
    fromCharacterId: z.string().min(1),
    toCharacterId: z.string().min(1),
    label: z.string().min(1),
    detail: z.string().min(1),
    state: z.enum(['starts', 'updates', 'ends']),
    ...sourced,
  })),
  summaries: z.array(z.object({
    id: z.string().min(1),
    characterId: z.string().min(1),
    summary: z.string().min(1),
    inputRecordIds: z.array(z.string().min(1)),
    ...sourced,
  })),
  storySentences: z.array(z.object({
    id: z.string().min(1),
    characterId: z.string().min(1),
    sentence: z.string().min(1),
    inputRecordIds: z.array(z.string().min(1)).min(1),
    importance: z.enum(['major', 'supporting', 'minor']),
    ...sourced,
  })),
})

export type ChunkExtraction = z.infer<typeof chunkExtractionSchema>

const sourceProperties = {
  sourceSequence: { type: 'integer', minimum: 1 },
  sourceBlockId: { type: 'string', minLength: 1 },
} as const

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
})

export const chunkExtractionJsonSchema = object({
  entities: {
    type: 'array',
    items: object({ id: { type: 'string', minLength: 1 } }),
  },
  names: {
    type: 'array',
    items: object({
      id: { type: 'string', minLength: 1 },
      characterId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1 },
      kind: { type: 'string', enum: ['name', 'alias', 'title'] },
      ...sourceProperties,
    }),
  },
  observations: {
    type: 'array',
    items: object({
      id: { type: 'string', minLength: 1 },
      characterId: { type: 'string', minLength: 1 },
      kind: { type: 'string', enum: ['Introduction', 'Attribute', 'Action', 'Relationship', 'Location', 'Goal', 'Revelation', 'Status'] },
      summary: { type: 'string', minLength: 1 },
      evidenceBlockIds: { type: 'array', items: { type: 'string', minLength: 1 } },
      ...sourceProperties,
    }),
  },
  relationships: {
    type: 'array',
    items: object({
      id: { type: 'string', minLength: 1 },
      fromCharacterId: { type: 'string', minLength: 1 },
      toCharacterId: { type: 'string', minLength: 1 },
      label: { type: 'string', minLength: 1 },
      detail: { type: 'string', minLength: 1 },
      state: { type: 'string', enum: ['starts', 'updates', 'ends'] },
      ...sourceProperties,
    }),
  },
  summaries: {
    type: 'array',
    items: object({
      id: { type: 'string', minLength: 1 },
      characterId: { type: 'string', minLength: 1 },
      summary: { type: 'string', minLength: 1 },
      inputRecordIds: { type: 'array', items: { type: 'string', minLength: 1 } },
      ...sourceProperties,
    }),
  },
  storySentences: {
    type: 'array',
    items: object({
      id: { type: 'string', minLength: 1 },
      characterId: { type: 'string', minLength: 1 },
      sentence: { type: 'string', minLength: 1 },
      inputRecordIds: { type: 'array', items: { type: 'string', minLength: 1 } },
      importance: { type: 'string', enum: ['major', 'supporting', 'minor'] },
      ...sourceProperties,
    }),
  },
})
