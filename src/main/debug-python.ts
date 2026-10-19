import { DapClient } from './dap'
import type {
  Breakpoint,
  Control,
  DebugEval,
  DebugEvent,
  DebugFrame,
  DebugScope,
  DebugSession,
  DebugVar,
  SessionDeps
} from './debug-types'

// Python debugging through debugpy, which speaks the real Debug Adapter Protocol. The program is started
// as `python -m debugpy --listen host:port --wait-for-client script.py`; we connect, configure, and go.

const CONNECT_TIMEOUT_MS = 20000
const COMMANDS: Record<Control, string> = {
  resume: 'continue',
  stepOver: 'next',
  stepInto: 'stepIn',
  stepOut: 'stepOut',
  pause: 'pause'
}

/** Maps Python type names to the names the UI colors. */
function normType(t: string | undefined): string {
  switch (t) {
    case 'str':
      return 'string'
    case 'int':
    case 'float':
    case 'complex':
      return 'number'
    case 'bool':
      return 'boolean'
    case 'NoneType':
      return 'undefined'
    default:
      return t ?? ''
  }
}

/** debugpy reports evaluation errors as whole tracebacks; the last line is the one a person wants. */
const lastLine = (msg: string): string => msg.trim().split('\n').filter(Boolean).pop() ?? msg

export class PythonSession implements DebugSession {
  ptyId = -1
  private client: DapClient | null = null
  private ready = false
  private ended = false
  private threadId = 1
  private resolveInitialized: () => void = () => undefined
  private initialized = new Promise<void>((resolve) => (this.resolveInitialized = resolve))

  constructor(private deps: SessionDeps) {}

  private emit(evt: DebugEvent): void {
    if (!this.deps.wc.isDestroyed()) this.deps.wc.send('debug:event', evt)
  }

  get connected(): boolean {
    return this.ready && !this.ended
  }

  onOutput(): void {
    // Nothing to parse: we chose the port ourselves.
  }

  onProcessExit(): void {
    this.finish()
  }

  /** Connects to debugpy on `port` and runs the DAP startup handshake. */
  start(port: number): void {
    this.run(port).catch((err: Error) => {
      if (this.ended) {
        this.emit({
          type: 'error',
          message: 'Python exited before the debugger attached — is debugpy installed? (try: uv pip install debugpy)'
        })
      } else this.emit({ type: 'error', message: `Debugger attach failed: ${err.message}` })
    })
  }

  private async run(port: number): Promise<void> {
    const client = await DapClient.connect(port, CONNECT_TIMEOUT_MS, () => this.ended)
    this.client = client
    client.onEvent = (event, body) => this.onEvent(event, body)
    client.onClose = () => this.finish()
    await client.request('initialize', {
      clientID: 'forge',
      adapterID: 'python',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true
    })
    // debugpy answers `attach` only after configurationDone, so don't await it yet.
    const attached = client.request('attach', { justMyCode: true })
    await this.initialized
    for (const [path, lines] of this.deps.desired) await this.setBreakpoints(path, lines)
    await client.request('configurationDone')
    await attached
    this.ready = true
  }

  private onEvent(event: string, body: any): void {
    if (event === 'initialized') this.resolveInitialized()
    else if (event === 'stopped') {
      this.threadId = body.threadId ?? this.threadId
      this.onStopped(String(body.reason ?? 'pause')).catch((err: Error) => this.emit({ type: 'error', message: err.message }))
    } else if (event === 'continued') this.emit({ type: 'continued' })
    else if (event === 'terminated') this.finish()
  }

  private async onStopped(reason: string): Promise<void> {
    const res = await this.need().request<{ stackFrames: any[] }>('stackTrace', {
      threadId: this.threadId,
      startFrame: 0,
      levels: 50
    })
    const frames = res.stackFrames.map(
      (f): DebugFrame => ({
        id: f.id,
        name: f.name,
        path: f.source?.path ?? null,
        line: f.line,
        column: f.column
      })
    )
    this.emit({ type: 'stopped', reason, frames })
  }

  private need(): DapClient {
    if (!this.client) throw new Error('Debugger is not connected')
    return this.client
  }

  private finish(): void {
    if (this.ended) return
    this.ended = true
    this.client?.close()
    this.emit({ type: 'ended' })
    this.deps.onEnded()
  }

  private async setBreakpoints(path: string, bps: Breakpoint[]): Promise<void> {
    // DAP replaces the whole set for a file, so an empty list clears it. Conditions and logpoints are built in.
    await this.need().request('setBreakpoints', {
      source: { path },
      breakpoints: bps.map((b) => ({ line: b.line, condition: b.condition?.trim() || undefined, logMessage: b.logMessage || undefined }))
    })
  }

  applyBreakpoints(path: string, bps: Breakpoint[]): Promise<void> {
    return this.setBreakpoints(path, bps)
  }

  control(cmd: Control): Promise<unknown> {
    return this.need().request(COMMANDS[cmd], { threadId: this.threadId })
  }

  async scopes(frameId: number): Promise<DebugScope[]> {
    const res = await this.need().request<{ scopes: { name: string; variablesReference: number }[] }>('scopes', { frameId })
    // "Globals" repeats the module's names and drags in builtins; show it only when it's all there is.
    const useful = res.scopes.filter((s) => s.name !== 'Globals')
    return (useful.length ? useful : res.scopes).map((s) => ({ name: s.name, ref: s.variablesReference }))
  }

  async variables(ref: number): Promise<DebugVar[]> {
    const res = await this.need().request<{ variables: { name: string; value: string; type?: string; variablesReference: number }[] }>(
      'variables',
      { variablesReference: ref }
    )
    return res.variables.map((v) => ({
      name: v.name,
      value: v.value,
      type: normType(v.type),
      ref: v.variablesReference
    }))
  }

  async evaluate(frameId: number, expression: string): Promise<DebugEval> {
    try {
      const res = await this.need().request<{ result: string; type?: string; variablesReference?: number }>('evaluate', {
        expression,
        frameId,
        context: 'repl'
      })
      return { value: res.result, type: normType(res.type), ref: res.variablesReference ?? 0, isError: false }
    } catch (err) {
      // A failing expression is a normal answer in a REPL, not a debugger failure.
      return { value: lastLine((err as Error).message), type: 'error', ref: 0, isError: true }
    }
  }
}
