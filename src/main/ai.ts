import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, safeStorage, type WebContents } from 'electron'

// The AI client behind the chat panel, the selection actions, inline completions and commit messages. It speaks the
// OpenAI-compatible "chat completions" protocol, which OpenAI, Anthropic (its compatibility endpoint), Ollama, LM Studio
// and many proxies understand, so one base URL + model + key covers all of them. It runs in the main process so the
// page's security rules do not apply and the API key never reaches the renderer.

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiRequest {
  /** e.g. https://api.openai.com/v1 or http://localhost:11434/v1 */
  baseUrl: string
  model: string
  messages: AiMessage[]
  maxTokens?: number
  temperature?: number
  /** Overall limit for the request; streamed answers get the full time. */
  timeoutMs?: number
}

export type AiEvent = { id: number; type: 'delta'; text: string } | { id: number; type: 'done' } | { id: number; type: 'error'; message: string }

const DEFAULT_TIMEOUT_MS = 120000
const MAX_ERROR_CHARS = 600

// ---------------------------------------------------------------- the API key (encrypted, never in settings.json)

const keyFile = (): string => join(app.getPath('userData'), 'ai-key.bin')

export async function storeKey(key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('This system cannot encrypt the API key (no OS keychain is available), so Forge will not store it')
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(keyFile(), safeStorage.encryptString(key))
}

export async function clearKey(): Promise<void> {
  await rm(keyFile(), { force: true })
}

/** The stored key, or '' when none is set (local servers such as Ollama need none). */
export async function loadKey(): Promise<string> {
  let data: Buffer
  try {
    data = await readFile(keyFile())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The stored API key cannot be decrypted on this system')
  return safeStorage.decryptString(data)
}

// ---------------------------------------------------------------- the request

/** `https://host/v1/` -> a URL for `/chat/completions`; throws a readable message for anything unusable. */
export function endpointFor(baseUrl: string): URL {
  const trimmed = baseUrl.trim()
  if (!trimmed) throw new Error('AI is not set up: choose a base URL in Settings → AI')
  let url: URL
  try {
    url = new URL(trimmed.replace(/\/+$/, '') + '/chat/completions')
  } catch {
    throw new Error(`The AI base URL is not a valid URL: ${trimmed}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`The AI base URL must start with http:// or https://, not ${url.protocol}`)
  return url
}

async function post(req: AiRequest, stream: boolean, signal: AbortSignal): Promise<Response> {
  if (!req.model.trim()) throw new Error('AI is not set up: choose a model in Settings → AI')
  const url = endpointFor(req.baseUrl)
  const key = await loadKey()
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json' }
  if (key) headers['authorization'] = `Bearer ${key}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
      }),
      signal
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    throw new Error(`Could not reach ${url.host}: ${cause?.code ?? (err as Error).message}`)
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, MAX_ERROR_CHARS)
    throw new Error(`${url.host} answered ${res.status} ${res.statusText}${body ? `: ${body}` : ''}`)
  }
  return res
}

/** Splits an SSE buffer into complete `data:` payloads and the unfinished remainder. */
export function parseSse(buffer: string): { data: string[]; rest: string } {
  const data: string[] = []
  const lines = buffer.split(/\r?\n/)
  const rest = lines.pop() ?? ''
  for (const line of lines) {
    if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }
  return { data, rest }
}

const textOf = (chunk: unknown): string => {
  const choice = (chunk as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] }).choices?.[0]
  return choice?.delta?.content ?? choice?.message?.content ?? ''
}

/** One complete answer (used for inline completions, commit messages and the connection test). */
export async function complete(req: AiRequest): Promise<string> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await post(req, false, ctl.signal)
    const json = (await res.json()) as unknown
    return textOf(json)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`The AI request timed out after ${(req.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000} seconds`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const running = new Map<number, AbortController>()
/** Requests the user cancelled, so their abort is told apart from a timeout. */
const cancelled = new Set<number>()

/** Streams an answer, sending `delta` events and finally `done` or `error` to the window that asked. */
async function stream(sender: WebContents, id: number, req: AiRequest): Promise<void> {
  const ctl = new AbortController()
  running.set(id, ctl)
  const send = (e: AiEvent): void => {
    if (!sender.isDestroyed()) sender.send('ai:event', e)
  }
  const timer = setTimeout(() => ctl.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await post(req, true, ctl.signal)
    const reader = res.body?.getReader()
    if (!reader) throw new Error('The AI server sent no response body')
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseSse(buffer)
      buffer = parsed.rest
      for (const payload of parsed.data) {
        if (payload === '[DONE]') continue
        let chunk: unknown
        try {
          chunk = JSON.parse(payload)
        } catch {
          throw new Error(`The AI server sent something that is not JSON: ${payload.slice(0, 120)}`)
        }
        const err = (chunk as { error?: { message?: string } }).error
        if (err) throw new Error(err.message ?? 'The AI server reported an error')
        const text = textOf(chunk)
        if (text) send({ id, type: 'delta', text })
      }
    }
    send({ id, type: 'done' })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      // Stopping is the user's own action, so what was streamed so far stands; only a timeout is an error.
      send(cancelled.has(id) ? { id, type: 'done' } : { id, type: 'error', message: `The AI request timed out after ${(req.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000} seconds` })
    } else {
      send({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    clearTimeout(timer)
    running.delete(id)
    cancelled.delete(id)
  }
}

export function registerAi(): void {
  ipcMain.handle('ai:key-set', (_e, key: string) => storeKey(key))
  ipcMain.handle('ai:key-clear', () => clearKey())
  ipcMain.handle('ai:key-status', async () => ({ stored: (await loadKey().catch(() => '')) !== '', encryption: safeStorage.isEncryptionAvailable() }))
  ipcMain.handle('ai:chat', (e, id: number, req: AiRequest) => {
    void stream(e.sender, id, req)
  })
  ipcMain.handle('ai:cancel', (_e, id: number) => {
    const ctl = running.get(id)
    if (!ctl) return
    cancelled.add(id)
    ctl.abort()
  })
  ipcMain.handle('ai:complete', (_e, req: AiRequest) => complete(req))
  /** A tiny request that proves the URL, key and model work together. */
  ipcMain.handle('ai:test', async (_e, baseUrl: string, model: string) => {
    const started = Date.now()
    const reply = await complete({ baseUrl, model, messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 16, temperature: 0, timeoutMs: 30000 })
    return { reply: reply.trim(), ms: Date.now() - started }
  })
}
