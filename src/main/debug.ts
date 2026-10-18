import { fileURLToPath, pathToFileURL } from 'node:url'
import { ipcMain, type WebContents } from 'electron'
import WebSocket from 'ws'
import { startPty, type PtySpec } from './terminal'

// A small debug adapter for Node, speaking the V8 inspector (Chrome DevTools) protocol over the
// WebSocket that `node --inspect-brk` opens. The renderer sees DAP-shaped requests and events.

export interface DebugFrame {
  id: number
  name: string
  path: string | null // null for node: internals and other non-file scripts
  line: number // 1-based
  column: number // 1-based
}

export interface DebugScope {
  name: string
  ref: number
}

export interface DebugVar {
  name: string
  value: string
  type: string
  ref: number // > 0 when the value has children to expand
}

export interface DebugEval {
  value: string
  type: string
  ref: number
  isError: boolean
}

export type DebugEvent =
  | { type: 'stopped'; reason: string; frames: DebugFrame[] }
  | { type: 'continued' }
  | { type: 'ended' }
  | { type: 'error'; message: string }

type Control = 'resume' | 'stepOver' | 'stepInto' | 'stepOut' | 'pause'

interface RemoteObject {
  type: string
  subtype?: string
  value?: unknown
  unserializableValue?: string
  description?: string
  className?: string
  objectId?: string
}

interface CallFrame {
  callFrameId: string
  functionName: string
  url?: string
  location: { scriptId: string; lineNumber: number; columnNumber: number }
  scopeChain: { type: string; name?: string; object: RemoteObject }[]
}

const CONNECT_TIMEOUT_MS = 15000
const METHODS: Record<Control, string> = {
  resume: 'Debugger.resume',
  stepOver: 'Debugger.stepOver',
  stepInto: 'Debugger.stepInto',
  stepOut: 'Debugger.stepOut',
  pause: 'Debugger.pause'
}

/** Breakpoints the user has set, kept even with no session so they apply to the next launch. */
const desired = new Map<string, number[]>() // path -> 1-based lines

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function format(o: RemoteObject): string {
  switch (o.type) {
    case 'string':
      return clip(JSON.stringify(o.value), 200)
    case 'number':
    case 'boolean':
      return o.unserializableValue ?? String(o.value)
    case 'undefined':
      return 'undefined'
    case 'function':
      return clip((o.description ?? 'function').split('\n')[0] ?? 'function', 80)
    case 'object':
      return o.subtype === 'null' ? 'null' : clip(o.description ?? o.className ?? 'Object', 120)
    default:
      return clip(o.description ?? String(o.value), 120)
  }
}

class Session {
  private ws: WebSocket | null = null
  private nextMsg = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private scripts = new Map<string, string>() // scriptId -> url
  private frames: CallFrame[] = []
  private refs = new Map<number, string>() // our ref -> inspector objectId (valid while paused)
  private nextRef = 1
  private breakpointIds = new Map<string, Map<number, string>>() // path -> line -> inspector id
  private buffer = ''
  private connecting = false
  private ended = false
  private timer: NodeJS.Timeout
  ptyId = -1

  constructor(private wc: WebContents) {
    this.timer = setTimeout(() => {
      if (!this.ws) this.emit({ type: 'error', message: 'The debugger did not attach — no inspector URL was printed' })
    }, CONNECT_TIMEOUT_MS)
  }

  private emit(evt: DebugEvent): void {
    if (!this.wc.isDestroyed()) this.wc.send('debug:event', evt)
  }

  /** Watches the program's output for the line `Debugger listening on ws://...`. */
  onOutput(data: string): void {
    if (this.connecting) return
    this.buffer += data
    const m = /ws:\/\/[\w.:-]+\/[\w-]+/.exec(this.buffer)
    if (!m) return
    this.connecting = true
    this.buffer = ''
    this.connect(m[0]).catch((err: Error) => this.emit({ type: 'error', message: `Debugger attach failed: ${err.message}` }))
  }

  onProcessExit(): void {
    this.finish()
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    clearTimeout(this.timer)
    for (const p of this.pending.values()) p.reject(new Error('Debug session ended'))
    this.pending.clear()
    this.ws?.close()
    this.emit({ type: 'ended' })
    if (current === this) current = null
  }

  private send<T = any>(method: string, params: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('Debugger is not connected'))
      const id = this.nextMsg++
      this.pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  private async connect(url: string): Promise<void> {
    const ws = new WebSocket(url)
    this.ws = ws
    ws.on('message', (raw) => this.onMessage(JSON.parse(raw.toString())))
    ws.on('close', () => this.finish())
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    clearTimeout(this.timer)
    // Node stays alive after the script ends while a debugger is attached; this makes it tell us so.
    await this.send('NodeRuntime.notifyWhenWaitingForDisconnect', { enabled: true })
    await this.send('Runtime.enable')
    await this.send('Debugger.enable')
    for (const [path, lines] of desired) await this.applyBreakpoints(path, lines)
    // --inspect-brk holds the program at its first line until we say go.
    await this.send('Runtime.runIfWaitingForDebugger')
  }

  private onMessage(msg: { id?: number; method?: string; params?: any; result?: any; error?: { message: string } }): void {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
      return
    }
    if (msg.method === 'Debugger.scriptParsed') this.scripts.set(msg.params.scriptId, msg.params.url)
    else if (msg.method === 'NodeRuntime.waitingForDisconnect') this.ws?.close() // script finished: let node exit
    else if (msg.method === 'Debugger.paused') this.onPaused(msg.params)
    else if (msg.method === 'Debugger.resumed') {
      this.frames = []
      this.refs.clear()
      this.emit({ type: 'continued' })
    }
  }

  private onPaused(params: { reason: string; callFrames: CallFrame[]; hitBreakpoints?: string[] }): void {
    if (params.reason === 'Break on start') {
      void this.send('Debugger.resume').catch((err: Error) => this.emit({ type: 'error', message: err.message }))
      return
    }
    this.frames = params.callFrames
    this.refs.clear()
    this.nextRef = 1
    const frames = this.frames.map((cf, id): DebugFrame => {
      const url = cf.url || this.scripts.get(cf.location.scriptId) || ''
      return {
        id,
        name: cf.functionName || '(anonymous)',
        path: url.startsWith('file:') ? fileURLToPath(url) : null,
        line: cf.location.lineNumber + 1,
        column: cf.location.columnNumber + 1
      }
    })
    this.emit({ type: 'stopped', reason: params.hitBreakpoints?.length ? 'breakpoint' : params.reason, frames })
  }

  async applyBreakpoints(path: string, lines: number[]): Promise<void> {
    const have = this.breakpointIds.get(path) ?? new Map<number, string>()
    const want = new Set(lines)
    for (const [line, id] of have) {
      if (!want.has(line)) {
        await this.send('Debugger.removeBreakpoint', { breakpointId: id })
        have.delete(line)
      }
    }
    for (const line of want) {
      if (have.has(line)) continue
      const res = await this.send<{ breakpointId: string }>('Debugger.setBreakpointByUrl', {
        lineNumber: line - 1,
        url: pathToFileURL(path).href
      })
      have.set(line, res.breakpointId)
    }
    this.breakpointIds.set(path, have)
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  control(cmd: Control): Promise<unknown> {
    return this.send(METHODS[cmd])
  }

  private register(o: RemoteObject): number {
    if (!o.objectId) return 0
    const ref = this.nextRef++
    this.refs.set(ref, o.objectId)
    return ref
  }

  scopes(frameId: number): DebugScope[] {
    const frame = this.frames[frameId]
    if (!frame) throw new Error('Variables are only available while the program is paused')
    return frame.scopeChain
      .filter((s) => s.type !== 'global') // the global object is huge and rarely what you want
      .map((s) => ({
        name: s.type.charAt(0).toUpperCase() + s.type.slice(1) + (s.name ? `: ${s.name}` : ''),
        ref: this.register(s.object)
      }))
  }

  async variables(ref: number): Promise<DebugVar[]> {
    const objectId = this.refs.get(ref)
    if (!objectId) throw new Error('Variables are only available while the program is paused')
    const res = await this.send<{ result: { name: string; value?: RemoteObject; get?: unknown }[] }>('Runtime.getProperties', {
      objectId,
      ownProperties: true
    })
    return res.result
      .filter((p) => p.name !== '__proto__')
      .map((p) =>
        p.value
          ? { name: p.name, value: format(p.value), type: p.value.type, ref: this.register(p.value) }
          : { name: p.name, value: '(accessor)', type: 'accessor', ref: 0 }
      )
  }

  async evaluate(frameId: number, expression: string): Promise<DebugEval> {
    const frame = this.frames[frameId]
    if (!frame) throw new Error('Expressions can only be evaluated while the program is paused')
    const res = await this.send<{ result: RemoteObject; exceptionDetails?: { text: string; exception?: RemoteObject } }>(
      'Debugger.evaluateOnCallFrame',
      { callFrameId: frame.callFrameId, expression }
    )
    if (res.exceptionDetails) {
      const ex = res.exceptionDetails.exception
      return { value: ex ? format(ex) : res.exceptionDetails.text, type: 'error', ref: 0, isError: true }
    }
    return { value: format(res.result), type: res.result.type, ref: this.register(res.result), isError: false }
  }
}

let current: Session | null = null

function need(): Session {
  if (!current) throw new Error('No active debug session')
  return current
}

export function registerDebug(): void {
  /** Starts the program under the debugger in a pty; the returned id is that pty (shown in the Run tab). */
  ipcMain.handle('debug:launch', (e, cwd: string, cols: number, rows: number, spec: PtySpec): number => {
    current?.onProcessExit() // replacing a session that was still going
    const session = new Session(e.sender)
    current = session
    session.ptyId = startPty(
      e.sender,
      cwd,
      cols,
      rows,
      spec,
      (data) => session.onOutput(data),
      () => session.onProcessExit()
    )
    return session.ptyId
  })

  ipcMain.handle('debug:setBreakpoints', async (_e, path: string, lines: number[]) => {
    if (lines.length) desired.set(path, lines)
    else desired.delete(path)
    if (current?.connected) await current.applyBreakpoints(path, lines)
  })

  ipcMain.handle('debug:control', (_e, cmd: Control) => {
    if (!(cmd in METHODS)) throw new Error(`Unknown debug command: ${cmd}`)
    return need().control(cmd)
  })
  ipcMain.handle('debug:scopes', (_e, frameId: number) => need().scopes(frameId))
  ipcMain.handle('debug:variables', (_e, ref: number) => need().variables(ref))
  ipcMain.handle('debug:evaluate', (_e, frameId: number, expression: string) => need().evaluate(frameId, expression))
}
