import net from 'node:net'
import { ipcMain } from 'electron'
import { NodeSession } from './debug-node'
import { PythonSession } from './debug-python'
import type { Control, DebugKind, DebugSession, SessionDeps } from './debug-types'
import { startPty, type PtySpec } from './terminal'

export type { DebugEval, DebugEvent, DebugFrame, DebugKind, DebugScope, DebugVar } from './debug-types'

const METHODS: Control[] = ['resume', 'stepOver', 'stepInto', 'stepOut', 'pause']

/** Breakpoints the user has set (path -> 1-based lines), kept even with no session so they apply to the next launch. */
const desired = new Map<string, number[]>()

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

export function registerDebug(): void {
  /** Starts the program under the debugger in a pty; the returned id is that pty (shown in the Run tab). */
  ipcMain.handle(
    'debug:launch',
    async (e, cwd: string, cols: number, rows: number, spec: PtySpec, kind: DebugKind): Promise<number> => {
      if (kind !== 'node' && kind !== 'python') throw new Error(`Unknown debug kind: ${String(kind)}`)
      current?.onProcessExit() // replacing a session that was still going
      let session: DebugSession
      const deps: SessionDeps = {
        wc: e.sender,
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
      } else session = new NodeSession(deps)
      current = session
      session.ptyId = startPty(
        e.sender,
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
  )

  ipcMain.handle('debug:setBreakpoints', async (_e, path: string, lines: number[]) => {
    if (lines.length) desired.set(path, lines)
    else desired.delete(path)
    if (current?.connected) await current.applyBreakpoints(path, lines)
  })

  ipcMain.handle('debug:control', (_e, cmd: Control) => {
    if (!METHODS.includes(cmd)) throw new Error(`Unknown debug command: ${cmd}`)
    return need().control(cmd)
  })
  ipcMain.handle('debug:scopes', (_e, frameId: number) => need().scopes(frameId))
  ipcMain.handle('debug:variables', (_e, ref: number) => need().variables(ref))
  ipcMain.handle('debug:evaluate', (_e, frameId: number, expression: string) => need().evaluate(frameId, expression))
}
