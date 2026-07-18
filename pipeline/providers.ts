import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chunkExtractionJsonSchema, chunkExtractionSchema, type ChunkExtraction } from './extractionSchema'

export type ProviderName = 'codex' | 'claude' | 'stub'

export type ProviderAttempt = (provider: ProviderName, prompt: string) => Promise<ChunkExtraction>

type ProcessResult = {
  stdout: string
  stderr: string
  code: number
}

const run = (
  command: string,
  args: string[],
  input: string,
  cwd: string,
  timeoutMs = 240_000,
) => new Promise<ProcessResult>((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
  let stdout = ''
  let stderr = ''
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    child.kill('SIGTERM')
    reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)} seconds.`))
  }, timeoutMs)
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  child.on('error', (error) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    reject(error)
  })
  child.on('close', (code) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ stdout, stderr, code: code ?? 1 })
  })
  child.stdin.end(input)
})

const parseJsonObject = (raw: string): unknown => {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const direct = JSON.parse(trimmed) as unknown
  if (direct && typeof direct === 'object') {
    const wrapper = direct as Record<string, unknown>
    if (wrapper.structured_output) return wrapper.structured_output
    if (typeof wrapper.result === 'string') return parseJsonObject(wrapper.result)
  }
  return direct
}

export async function runExtractionProvider(
  provider: ProviderName,
  prompt: string,
  stub?: ChunkExtraction,
): Promise<ChunkExtraction> {
  if (provider === 'stub') {
    if (!stub) throw new Error('The stub provider needs a supplied extraction.')
    return chunkExtractionSchema.parse(stub)
  }

  const workingDirectory = await mkdtemp(join(tmpdir(), 'highlighter-provider-'))
  try {
    const schemaPath = join(workingDirectory, 'extraction.schema.json')
    await writeFile(schemaPath, `${JSON.stringify(chunkExtractionJsonSchema, null, 2)}\n`)
    const result = provider === 'codex'
      ? await run('codex', [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox', 'read-only',
        '-c', 'model_reasoning_effort="medium"',
        '--ignore-rules',
        '--color', 'never',
        '--output-schema', schemaPath,
        '-',
      ], prompt, workingDirectory)
      : await run('claude', [
        '--print',
        '--tools', '',
        '--no-session-persistence',
        '--output-format', 'json',
        '--json-schema', JSON.stringify(chunkExtractionJsonSchema),
      ], prompt, workingDirectory)

    if (result.code !== 0) {
      const safeTail = result.stderr.trim().split('\n').slice(-8).join('\n')
      throw new Error(`${provider} exited with code ${result.code}.${safeTail ? `\n${safeTail}` : ''}`)
    }
    return chunkExtractionSchema.parse(parseJsonObject(result.stdout))
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}

export async function runProviderChain<T>(
  providers: ProviderName[],
  prompt: string,
  accept: (extraction: ChunkExtraction) => T,
  runner: ProviderAttempt = (provider, value) => runExtractionProvider(provider, value),
  onAttempt?: (provider: ProviderName, attempt: number) => void,
) {
  const errors: string[] = []
  for (const provider of providers) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      onAttempt?.(provider, attempt)
      try {
        return { provider, value: accept(await runner(provider, prompt)) }
      } catch (error) {
        errors.push(`${provider} attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  throw new Error(`All extraction providers failed:\n${errors.join('\n')}`)
}
