import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { DapClient } from './dap'
import type {
  Breakpoint,
  Control,
  DapLaunch,
  DebugEval,
  DebugEvent,
  DebugFrame,
  DebugScope,
  DebugSession,
  DebugVar,
  SessionDeps
} from './debug-types'
import type { VirtualTerminal } from './terminal'

// Debugging with any Debug Adapter Protocol adapter the user configured (lldb-dap, delve, netcoredbg, a language's own...).
// Forge starts the adapter and speaks DAP to it over stdio or TCP. What the program prints (the adapter reports it as
// "output" events) is shown in the Run tab through a virtual terminal.

const STARTUP_TIMEOUT_MS = 20000
const COMMANDS: Record<Control, string> = {
  resume: 'continue',
  stepOver: 'next',
  stepInto: 'stepIn',
  stepOut: 'stepOut',
  pause: 'pause'
}

/** Adapters name types their own way; the UI colours a few common ones. */
function normType(t: string | undefined): string {
  if (!t) return ''
  const l = t.toLowerCase()
  if (/\b(bool|boolean)\b/.test(l)) return 'boolean'
  if (/\b(u?int\d*(_t)?|long|short|float|double|number|integer|size_t)\b/.test(l)) return 'number'
  if (/string|char\s*\*|\bstr\b/.test(l)) return 'string'
  if (/\b(null|nil|none|undefined|void)\b/.test(l)) return 'undefined'
  return t
}

const lastLine = (msg: string): string => msg.trim().split('\n').filter(Boolean).pop() ?? msg

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(() => resolve(port))
    })
  })

export class DapSession implements DebugSession {
  ptyId = -1
  private client: DapClient | null = null
  private child: ChildProcess | null = null
  private terminal: VirtualTerminal | null = null
  private ready = false
  private ended = false
  private threadId = 1
  private resolveInitialized: () => void = () => undefined
  private initialized = new Promise<void>((resolve) => (this.resolveInitialized = resolve))
  /** Rejects when the adapter cannot be started, so waiting for its answers stops at once. */
  private abort: (err: Error) => void = () => undefined
  private aborted = new Promise<never>((_, reject) => (this.abort = reject))

  constructor(
    private deps: SessionDeps,
    private launch: DapLaunch,
    private cwd: string
  ) {
    this.aborted.catch(() => undefined) // only observed while waiting; never an unhandled rejection
  }

  private emit(evt: DebugEvent): void {
    if (!this.deps.wc.isDestroyed()) this.deps.wc.send('debug:event', evt)
  }

  get connected(): boolean {
    return this.ready && !this.ended
  }

  /** The Run tab's terminal, which shows the program's output. */
  attach(terminal: VirtualTerminal): void {
    this.terminal = terminal
    this.ptyId = terminal.id
  }

  onOutput(): void {
    // A virtual terminal has no process output of its own.
  }

  onProcessExit(): void {
    this.finish()
  }

  private print(text: string): void {
    this.terminal?.print(text)
  }

  /** Starts the adapter and runs the DAP startup handshake. A failure is shown in the Run tab and as a debugger error. */
  start(): void {
    this.run().catch((err: Error) => {
      if (this.ended) return
      this.print(`\x1b[31m${err.message}\x1b[0m\r\n`)
      this.emit({ type: 'error', message: `Debugger: ${err.message}` })
      this.finish()
    })
  }

  private async run(): Promise<void> {
    const { adapter } = this.launch
    const port = adapter.transport === 'tcp' ? await freePort() : 0
    const args = adapter.args.map((a) => a.replace(/\$\{port\}/g, String(port)))
    const child = spawn(adapter.command, args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    let spawnFailed = false
    child.once('error', (err) => {
      spawnFailed = true
      this.abort(
        new Error(
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? `The debug adapter "${adapter.command}" was not found. Install it, or fix "adapter.command" in the run configuration.`
            : `Could not start the debug adapter: ${err.message}`
        )
      )
    })
    child.stderr?.on('data', (d: Buffer) => this.print(d.toString().replace(/\r?\n/g, '\r\n')))
    child.once('exit', (code) => {
      if (!this.ready && !this.ended && !spawnFailed) this.print(`\x1b[90m[debug adapter exited with code ${code}]\x1b[0m\r\n`)
      this.finish()
    })

    const client =
      adapter.transport === 'tcp'
        ? await Promise.race([DapClient.connect(port, STARTUP_TIMEOUT_MS, () => this.ended || spawnFailed), this.aborted])
        : DapClient.fromProcess(child)
    this.client = client
    client.onEvent = (event, body) => this.onEvent(event, body)
    client.onClose = () => this.finish()

    const init = await this.waitFor(
      client.request<{ supportsConfigurationDoneRequest?: boolean }>('initialize', {
        clientID: 'forge',
        adapterID: this.launch.adapterId,
        linesStartAt1: true,
        columnsStartAt1: true,
        pathFormat: 'path',
        supportsVariableType: true,
        supportsRunInTerminalRequest: false
      }),
      'initialize'
    )
    // Many adapters answer launch / attach only after configurationDone, so it is not awaited yet.
    const started = client.request(this.launch.request, this.launch.arguments)
    started.catch(() => undefined) // reported below, where it is awaited
    await this.waitFor(this.initialized, 'the adapter to say it is ready ("initialized")')
    for (const [path, lines] of this.deps.desired) await this.setBreakpoints(path, lines)
    if (init.supportsConfigurationDoneRequest !== false) await client.request('configurationDone')
    await started
    this.ready = true
  }

  /** Waits for `p`, but gives up when the adapter cannot be started or does not answer in time. */
  private waitFor<T>(p: Promise<T>, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`The debug adapter did not answer: waiting for ${what}`)), STARTUP_TIMEOUT_MS)
    })
    return Promise.race([p, this.aborted, timeout]).finally(() => clearTimeout(timer))
  }

  private onEvent(event: string, body: any): void {
    if (event === 'initialized') this.resolveInitialized()
    else if (event === 'stopped') {
      this.threadId = body.threadId ?? this.threadId
      this.onStopped(String(body.reason ?? 'pause')).catch((err: Error) => this.emit({ type: 'error', message: err.message }))
    } else if (event === 'continued') this.emit({ type: 'continued' })
    else if (event === 'terminated') this.finish()
    else if (event === 'output') {
      const category = String(body.category ?? 'console')
      if (category === 'telemetry') return
      const text = String(body.output ?? '')
      this.print((category === 'stderr' ? `\x1b[31m${text}\x1b[0m` : text).replace(/\r?\n/g, '\r\n'))
    }
  }

  private async onStopped(reason: string): Promise<void> {
    const res = await this.need().request<{ stackFrames: any[] }>('stackTrace', { threadId: this.threadId, startFrame: 0, levels: 50 })
    const frames = res.stackFrames.map(
      (f): DebugFrame => ({ id: f.id, name: f.name, path: f.source?.path ?? null, line: f.line, column: f.column })
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
    const client = this.client
    if (client && this.ready) client.request('disconnect', { terminateDebuggee: true }).catch(() => undefined)
    // Give a polite disconnect a moment, then make sure nothing is left running.
    setTimeout(() => {
      client?.close()
      if (this.child && !this.child.killed) this.child.kill()
    }, 300)
    this.terminal?.exit(0)
    this.emit({ type: 'ended' })
    this.deps.onEnded()
  }

  private async setBreakpoints(path: string, bps: Breakpoint[]): Promise<void> {
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
    const res = await this.need().request<{ scopes: { name: string; variablesReference: number; expensive?: boolean }[] }>('scopes', { frameId })
    return res.scopes.map((s) => ({ name: s.name, ref: s.variablesReference }))
  }

  async variables(ref: number): Promise<DebugVar[]> {
    const res = await this.need().request<{ variables: { name: string; value: string; type?: string; variablesReference?: number }[] }>('variables', {
      variablesReference: ref
    })
    return res.variables.map((v) => ({ name: v.name, value: v.value, type: normType(v.type), ref: v.variablesReference ?? 0 }))
  }

  async evaluate(frameId: number, expression: string): Promise<DebugEval> {
    try {
      const res = await this.need().request<{ result: string; type?: string; variablesReference?: number }>('evaluate', { expression, frameId, context: 'repl' })
      return { value: res.result, type: normType(res.type), ref: res.variablesReference ?? 0, isError: false }
    } catch (err) {
      return { value: lastLine((err as Error).message), type: 'error', ref: 0, isError: true }
    }
  }
}
