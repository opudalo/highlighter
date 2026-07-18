import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ParsedEpub, ProcessedBookArtifact } from '../src/types'

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

export async function writeQaReport(
  path: string,
  book: ParsedEpub,
  artifact: ProcessedBookArtifact,
  issues: string[],
) {
  const blocks = new Map(book.blocks.map((block) => [block.id, block]))
  const names = new Map<string, string>()
  for (const fact of artifact.names) names.set(fact.characterId, fact.name)
  const characterRows = artifact.entities.map((entity) => {
    const observations = artifact.observations.filter((record) => record.characterId === entity.id)
    const aliases = artifact.names.filter((record) => record.characterId === entity.id)
    return `<tr><td>${escapeHtml(names.get(entity.id) ?? entity.id)}</td><td>${aliases.length}</td><td>${observations.length}</td></tr>`
  }).join('')
  const observationRows = artifact.observations.map((observation) => {
    const source = blocks.get(observation.sourceBlockId)?.text ?? 'Missing source block'
    return `<article><p><strong>${escapeHtml(names.get(observation.characterId) ?? observation.characterId)}</strong> · ${observation.kind} · ¶${observation.sourceSequence}</p><p>${escapeHtml(observation.summary)}</p><blockquote>${escapeHtml(source)}</blockquote></article>`
  }).join('')
  const issueRows = issues.length > 0
    ? issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')
    : '<li>No structural issues found.</li>'
  const ownersByNormalizedName = new Map<string, Set<string>>()
  for (const fact of artifact.names) {
    const normalized = fact.name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const owners = ownersByNormalizedName.get(normalized) ?? new Set<string>()
    owners.add(fact.characterId)
    ownersByNormalizedName.set(normalized, owners)
  }
  const unresolvedAliases = [...ownersByNormalizedName.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([name, owners]) => `${name}: ${[...owners].join(', ')}`)
  const unnamedEntities = artifact.entities.filter((entity) => !artifact.names.some((fact) => fact.characterId === entity.id))
    .map((entity) => `${entity.id}: no source-positioned name fact`)
  const uncertaintyPattern = /\b(?:appears?|apparently|may|might|perhaps|possibly|seems?|unclear|unknown)\b/i
  const lowConfidence = [...artifact.observations, ...artifact.relationships, ...artifact.summaries, ...artifact.storySentences]
    .filter((record) => uncertaintyPattern.test('summary' in record ? record.summary : 'sentence' in record ? record.sentence : record.detail))
    .map((record) => `${record.id} at ¶${record.sourceSequence}`)
  const graphAnomalies: string[] = []
  const knownEntities = new Set(artifact.entities.map((entity) => entity.id))
  const activePairs = new Set<string>()
  for (const relationship of [...artifact.relationships].sort((a, b) => a.sourceSequence - b.sourceSequence)) {
    const pair = [relationship.fromCharacterId, relationship.toCharacterId].sort().join(' ↔ ')
    if (!knownEntities.has(relationship.fromCharacterId) || !knownEntities.has(relationship.toCharacterId)) {
      graphAnomalies.push(`${relationship.id}: dangling endpoint`)
    } else if (relationship.fromCharacterId === relationship.toCharacterId) {
      graphAnomalies.push(`${relationship.id}: self-relationship`)
    } else if (relationship.state === 'ends' && !activePairs.has(pair)) {
      graphAnomalies.push(`${relationship.id}: ends before a start`)
    }
    if (relationship.state === 'ends') activePairs.delete(pair)
    else activePairs.add(pair)
  }
  const qaList = (items: string[], empty: string) => items.length > 0
    ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : `<li>${escapeHtml(empty)}</li>`
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(book.metadata.title)} extraction QA</title><style>body{font:15px system-ui;max-width:960px;margin:40px auto;padding:0 24px;color:#1d2521}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}article{padding:16px 0;border-bottom:1px solid #ddd}blockquote{margin:8px 0;padding:12px;background:#f4f1e9}li{margin:6px 0}</style><h1>${escapeHtml(book.metadata.title)} extraction QA</h1><p>Fingerprint: <code>${book.fingerprint}</code></p><h2>Validator failures</h2><ul>${issueRows}</ul><h2>Unresolved aliases and identities</h2><ul>${qaList([...unresolvedAliases, ...unnamedEntities], 'No unresolved aliases or unnamed entities detected.')}</ul><h2>Low-confidence review</h2><p>Records are flagged here by uncertainty language for local human review; confidence is not published in the artifact.</p><ul>${qaList(lowConfidence, 'No uncertainty-language records detected.')}</ul><h2>Graph anomalies</h2><ul>${qaList(graphAnomalies, 'No graph anomalies detected.')}</ul><h2>Characters</h2><table><thead><tr><th>Character</th><th>Name facts</th><th>Observations</th></tr></thead><tbody>${characterRows}</tbody></table><h2>Source review</h2>${observationRows}</html>`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, html)
}
