import net from 'node:net'
import { DapSession } from './debug-dap'
import { NodeSession } from './debug-node'
import { PythonSession } from './debug-python'
import type { Breakpoint, Control, DapLaunch, DebugKind, DebugSession, SessionDeps } from './debug-types'
import { startPty, startVirtual, type PtySpec } from './terminal'

export type { DapLaunch, DebugEval, DebugEvent, DebugFrame, DebugKind, DebugScope, DebugVar } from './debug-types'

const METHODS: Control[] = ['resume', 'stepOver', 'stepInto', 'stepOut', 'pause']

/** Breakpoints the user has set (path -> breakpoints), kept even with no session so they apply to the next launch. */
const desired = new Map<string, Breakpoint[]>()

let current: DebugSession | null = null

function need(): DebugSession {
  if (!current) throw new Error('No active debug session')
  return current
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(() => resolve(port))
    })
  })

/**
 * Wraps a Python launch (`python -u script args…`, as built by the renderer) so debugpy starts the program
 * and waits for us to connect.
 */
function pythonDebugSpec(spec: PtySpec, port: number): PtySpec {
  const rest = spec.args[0] === '-u' ? spec.args.slice(1) : spec.args
  return {
    ...spec,
    // -Xfrozen_modules=off: otherwise debugpy warns that it may miss breakpoints in frozen stdlib modules.
    args: ['-Xfrozen_modules=off', '-u', '-m', 'debugpy', '--listen', `127.0.0.1:${port}`, '--wait-for-client', ...rest]
  }
}

/** The renderer sends the adapter configuration; refuse anything that is not what it should be before starting a process. */
function checkDapLaunch(dap: DapLaunch | undefined): void {
  const a = dap?.adapter
  if (!dap || !a || typeof a.command !== 'string' || !a.command.trim()) throw new Error('This configuration needs an "adapter" with a "command"')
  if (!Array.isArray(a.args) || a.args.some((x) => typeof x !== 'string')) throw new Error('"adapter.args" must be a list of strings')
  if (a.transport !== 'stdio' && a.transport !== 'tcp') throw new Error('"adapter.transport" must be "stdio" or "tcp"')
  if (dap.request !== 'launch' && dap.request !== 'attach') throw new Error('"request" must be "launch" or "attach"')
}

type Emit = (topic: string, payload: unknown) => void
let emitToUi: Emit = () => {
  throw new Error('Debugger events have no destination: the platform did not set an emitter')
}
/** Where debugger events go ("debug.event"); the platform sets it at start-up. */
export function setDebugEmitter(fn: Emit): void {
  emitToUi = fn
}

/** Provided as the "debug" service (see platform). */
export class DebugService {
  /** Starts the program under the debugger in a pty; the returned id is that pty (shown in the Run tab). */
  async launch(cwd: string, cols: number, rows: number, spec: PtySpec, kind: DebugKind, dap?: DapLaunch): Promise<number> {
    if (kind !== 'node' && kind !== 'python' && kind !== 'dap') throw new Error(`Unknown debug kind: ${String(kind)}`)
    if (kind === 'dap') checkDapLaunch(dap)
    current?.onProcessExit() // replacing a session that was still going
    let session: DebugSession
    const deps: SessionDeps = {
      emit: (evt) => emitToUi('debug.event', evt),
      desired,
      onEnded: () => {
        if (current === session) current = null
      }
    }
    let launch = spec
    let port = 0
    if (kind === 'python') {
      port = await freePort()
      launch = pythonDebugSpec(spec, port)
      session = new PythonSession(deps)
    } else if (kind === 'dap' && dap) {
      // The program runs under the adapter, so the Run tab gets a terminal with no process: it shows what the adapter reports.
      const dapSession = new DapSession(deps, dap, cwd)
      dapSession.attach(startVirtual(() => dapSession.onProcessExit()))
      current = dapSession
      // The Run tab only listens to this terminal once this call has returned: don't print before then.
      setTimeout(() => dapSession.start(), 150)
      return dapSession.ptyId
    } else session = new NodeSession(deps)
    current = session
    session.ptyId = startPty(
      cwd,
      cols,
      rows,
      launch,
      (data) => session.onOutput(data),
      () => session.onProcessExit()
    )
    if (session instanceof PythonSession) session.start(port)
    return session.ptyId
  }

  async setBreakpoints(path: string, bps: Breakpoint[]) {
    if (bps.length) desired.set(path, bps)
    else desired.delete(path)
    if (current?.connected) await current.applyBreakpoints(path, bps)
  }

  async control(cmd: Control): Promise<void> {
    if (!METHODS.includes(cmd)) throw new Error(`Unknown debug command: ${cmd}`)
    await need().control(cmd)
  }

  scopes(frameId: number) {
    return need().scopes(frameId)
  }

  variables(ref: number) {
    return need().variables(ref)
  }

  evaluate(frameId: number, expression: string) {
    return need().evaluate(frameId, expression)
  }
}

export type DebugApi = DebugService

