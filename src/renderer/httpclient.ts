import * as monaco from 'monaco-editor'
import type { HttpRequestSpec, HttpResponse } from '../main/http'

// .http files: write requests as text, run them with the green arrow in the gutter (or Ctrl+Enter), read the answer in
// the Response window.
//
//   @host = https://example.com           <- variables used as {{host}}
//   ### Create an item                    <- a request starts after ###
//   POST {{host}}/items
//   Content-Type: application/json
//
//   { "name": "x" }

export interface HttpBlock {
  /** 1-based first and last line of the request's text. */
  from: number
  to: number
  /** The line with the method and URL. */
  requestLine: number
  title: string
  spec: HttpRequestSpec
}

const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S.*?)(?:\s+HTTP\/[\d.]+)?\s*$/i

/** Built-in variables: {{$uuid}}, {{$timestamp}}, {{$randomInt}}. */
function builtin(name: string): string | undefined {
  if (name === '$uuid') return crypto.randomUUID()
  if (name === '$timestamp') return String(Math.floor(Date.now() / 1000))
  if (name === '$randomInt') return String(Math.floor(Math.random() * 1000))
  return undefined
}

/** Splits a .http file into requests. Variables from "@name = value" lines are filled in. */
export function parseHttp(text: string): { blocks: HttpBlock[]; problems: { line: number; message: string }[] } {
  const lines = text.split(/\r?\n/)
  const vars = new Map<string, string>()
  for (const l of lines) {
    const m = /^@([\w.-]+)\s*=\s*(.*)$/.exec(l.trim())
    if (m) vars.set(m[1]!, m[2]!.trim())
  }
  const fill = (s: string): { text: string; missing: string[] } => {
    const missing: string[] = []
    const out = s.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (all, name: string) => {
      const v = vars.get(name) ?? builtin(name)
      if (v === undefined) missing.push(name)
      return v ?? all
    })
    return { text: out, missing }
  }

  const blocks: HttpBlock[] = []
  const problems: { line: number; message: string }[] = []
  // Each chunk starts at the line after a ### separator (or the file start).
  let start = 0
  const bounds: [number, number][] = []
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || /^###/.test(lines[i] ?? '')) {
      bounds.push([start, i - 1])
      start = i + 1
    }
  }
  for (const [a, b] of bounds) {
    let i = a
    let title = ''
    // Skip blanks, comments and variable definitions up to the request line.
    for (; i <= b; i++) {
      const l = (lines[i] ?? '').trim()
      if (l === '' || l.startsWith('@')) continue
      if (l.startsWith('#') || l.startsWith('//')) {
        title ||= l.replace(/^(#|\/\/)\s*/, '')
        continue
      }
      break
    }
    if (i > b) continue
    const m = METHOD.exec((lines[i] ?? '').trim())
    if (!m) {
      problems.push({ line: i + 1, message: 'Expected a request like "GET https://example.com/path"' })
      continue
    }
    const headers: Record<string, string> = {}
    let j = i + 1
    for (; j <= b; j++) {
      const l = lines[j] ?? ''
      if (l.trim() === '') break
      if (l.trim().startsWith('#') || l.trim().startsWith('//')) continue
      const h = /^([\w-]+)\s*:\s*(.*)$/.exec(l)
      if (!h) {
        problems.push({ line: j + 1, message: 'Headers look like "Name: value"; a blank line starts the body' })
        break
      }
      headers[h[1]!] = fill(h[2]!).text
    }
    const bodyLines: string[] = []
    for (let k = j + 1; k <= b; k++) bodyLines.push(lines[k] ?? '')
    while (bodyLines.length && bodyLines[bodyLines.length - 1]!.trim() === '') bodyLines.pop()
    const url = fill(m[2]!)
    const body = fill(bodyLines.join('\n')).text
    const missing = url.missing
    if (missing.length) problems.push({ line: i + 1, message: `Undefined variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` })
    let last = b
    while (last > i && (lines[last] ?? '').trim() === '') last--
    blocks.push({
      from: a + 1,
      to: last + 1,
      requestLine: i + 1,
      title: title || `${m[1]!.toUpperCase()} ${url.text}`,
      spec: { method: m[1]!.toUpperCase(), url: url.text, headers, body: body || undefined }
    })
  }
  return { blocks, problems }
}

export interface HttpDeps {
  editor: monaco.editor.IStandaloneCodeEditor
  /** The window's own root element. */
  root: HTMLElement
  /** Whether the file in the editor is a .http file. */
  isHttpFile: () => boolean
  /** Brings the Response window on screen. */
  reveal: () => void
  report: (msg: string, isError?: boolean) => void
}

export interface HttpClient {
  /** Runs the request the cursor is in. */
  runAtCursor: () => Promise<void>
}

const statusClass = (s: number): string => (s >= 500 ? 'err' : s >= 400 ? 'warn' : s >= 300 ? 'info' : 'ok')

export function initHttpClient(d: HttpDeps): HttpClient {
  // ---- syntax coloring for .http ----
  monaco.languages.register({ id: 'http', extensions: ['.http', '.rest'], aliases: ['HTTP'] })
  monaco.languages.setMonarchTokensProvider('http', {
    tokenizer: {
      root: [
        [/^###.*$/, 'comment.doc'],
        [/^\s*(#|\/\/).*$/, 'comment'],
        [/^@[\w.-]+/, 'variable.predefined'],
        [/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/, 'keyword'],
        [/\{\{[^}]*\}\}/, 'variable'],
        [/^[\w-]+(?=\s*:)/, 'type'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/\b\d+(?:\.\d+)?\b/, 'number']
      ]
    }
  })

  // ---- the Response window ----
  const bar = document.createElement('div')
  bar.className = 'tool-bar'
  const statusEl = document.createElement('span')
  statusEl.className = 'http-status'
  statusEl.textContent = 'No response yet'
  const meta = document.createElement('span')
  meta.className = 'http-meta'
  const copy = document.createElement('button')
  copy.className = 'btn'
  copy.textContent = 'Copy body'
  const tabBody = document.createElement('button')
  tabBody.className = 'chip on info'
  tabBody.textContent = 'Body'
  const tabHeaders = document.createElement('button')
  tabHeaders.className = 'chip info'
  tabHeaders.textContent = 'Headers'
  bar.append(statusEl, meta, el('span', 'grow'), tabBody, tabHeaders, copy)
  const view = document.createElement('pre')
  view.className = 'http-body'
  view.id = 'http-body'
  d.root.replaceChildren(bar, view)

  function el(tag: string, cls: string): HTMLElement {
    const e = document.createElement(tag)
    e.className = cls
    return e
  }

  let last: HttpResponse | null = null
  let showing: 'body' | 'headers' = 'body'
  function draw(): void {
    if (!last) return
    if (showing === 'headers') view.textContent = last.headers.map(([k, v]) => `${k}: ${v}`).join('\n')
    else {
      let body = last.body
      // Readable JSON: re-indent it (the text is left alone if it is not valid JSON).
      try {
        body = JSON.stringify(JSON.parse(last.body), null, 2)
      } catch {
        /* not JSON: shown as received */
      }
      view.textContent = body + (last.truncated ? '\n\n… (cut off at 2 MB)' : '')
    }
    tabBody.classList.toggle('on', showing === 'body')
    tabHeaders.classList.toggle('on', showing === 'headers')
  }
  tabBody.onclick = () => ((showing = 'body'), draw())
  tabHeaders.onclick = () => ((showing = 'headers'), draw())
  copy.onclick = () => {
    if (last) void window.forge.copyText(last.body)
  }

  function show(title: string, res: HttpResponse): void {
    last = res
    statusEl.className = `http-status ${statusClass(res.status)}`
    statusEl.textContent = `${res.status} ${res.statusText}`
    meta.textContent = `${title} · ${res.timeMs} ms · ${res.bytes < 1024 ? `${res.bytes} B` : `${(res.bytes / 1024).toFixed(1)} KB`}`
    draw()
    d.reveal()
  }

  function showError(title: string, message: string): void {
    last = null
    statusEl.className = 'http-status err'
    statusEl.textContent = 'Request failed'
    meta.textContent = title
    view.textContent = message
    d.reveal()
  }

  async function run(block: HttpBlock): Promise<void> {
    d.report(`Sending ${block.spec.method} ${block.spec.url}`)
    statusEl.className = 'http-status'
    statusEl.textContent = 'Sending…'
    try {
      show(block.title, await window.forge.httpSend(block.spec))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showError(block.title, message)
      d.report(`HTTP request: ${message}`, true)
    }
  }

  // ---- gutter arrows ----
  const arrows = d.editor.createDecorationsCollection()
  let blocks: HttpBlock[] = []
  function scan(): void {
    const model = d.editor.getModel()
    if (!model || !d.isHttpFile()) {
      blocks = []
      arrows.clear()
      return
    }
    const parsed = parseHttp(model.getValue())
    blocks = parsed.blocks
    arrows.set(
      blocks.map((b) => ({
        range: new monaco.Range(b.requestLine, 1, b.requestLine, 1),
        options: { glyphMarginClassName: 'http-run-glyph', glyphMarginHoverMessage: { value: `Run ${b.spec.method} ${b.spec.url}` } }
      }))
    )
    monaco.editor.setModelMarkers(
      model,
      'http',
      parsed.problems.map((p) => ({
        severity: monaco.MarkerSeverity.Warning,
        message: p.message,
        startLineNumber: p.line,
        startColumn: 1,
        endLineNumber: p.line,
        endColumn: model.getLineMaxColumn(p.line)
      }))
    )
  }
  let timer: number | undefined
  const later = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(scan, 200)
  }
  d.editor.onDidChangeModel(scan)
  d.editor.onDidChangeModelContent(later)

  d.editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position || !d.isHttpFile()) return
    const line = e.target.position.lineNumber
    const block = blocks.find((b) => b.requestLine === line)
    if (block) void run(block)
  })

  d.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    if (d.isHttpFile()) void runAtCursor().catch((err: unknown) => d.report(String(err), true))
  })

  async function runAtCursor(): Promise<void> {
    scan()
    const line = d.editor.getPosition()?.lineNumber ?? 1
    const block = blocks.find((b) => line >= b.from && line <= b.to) ?? blocks[0]
    if (!block) return d.report('No request found here. A request is a line like "GET https://example.com".', true)
    await run(block)
  }

  return { runAtCursor }
}
