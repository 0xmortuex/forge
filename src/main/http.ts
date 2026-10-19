import { ipcMain } from 'electron'

// The HTTP client behind `.http` files: sends one request and returns what came back. It runs in the main process so the
// page's security rules (CORS, content security policy) do not apply to the user's own requests.

export interface HttpRequestSpec {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: [string, string][]
  body: string
  /** True when the body was cut at the size limit. */
  truncated: boolean
  timeMs: number
  /** Size of the body as received, in bytes. */
  bytes: number
}

const TIMEOUT_MS = 30000
const MAX_BODY_BYTES = 2 * 1024 * 1024
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export async function sendRequest(spec: HttpRequestSpec): Promise<HttpResponse> {
  const method = spec.method.toUpperCase()
  if (!METHODS.has(method)) throw new Error(`Unsupported HTTP method: ${spec.method}`)
  let url: URL
  try {
    url = new URL(spec.url)
  } catch {
    throw new Error(`Not a valid URL: ${spec.url}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Only http and https URLs can be requested, not ${url.protocol}`)
  const started = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method,
      headers: spec.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : spec.body,
      signal: ctl.signal,
      redirect: 'follow'
    })
    // Read at most MAX_BODY_BYTES; a huge download is cut off rather than held in memory.
    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    let truncated = false
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_BODY_BYTES) {
        truncated = true
        await reader.cancel()
        break
      }
      chunks.push(value)
    }
    return {
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      body: Buffer.concat(chunks).toString('utf8'),
      truncated,
      timeMs: Date.now() - started,
      bytes
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`The request timed out after ${TIMEOUT_MS / 1000} seconds`)
    // Node reports connection problems as "fetch failed" with the real reason in `cause`.
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    throw new Error(cause?.code ? `${(err as Error).message}: ${cause.code}${cause.message ? ` (${cause.message})` : ''}` : (err as Error).message)
  } finally {
    clearTimeout(timer)
  }
}

export function registerHttp(): void {
  ipcMain.handle('http:send', (_e, spec: HttpRequestSpec) => sendRequest(spec))
}
