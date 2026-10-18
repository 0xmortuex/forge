import { existsSync } from 'node:fs'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import * as pty from 'node-pty'

const terms = new Map<number, pty.IPty>()
let nextId = 1

function getTerm(id: number): pty.IPty {
  const t = terms.get(id)
  if (!t) throw new Error(`No terminal with id ${id}`)
  return t
}

export interface PtySpec {
  file: string
  args: string[]
  env?: Record<string, string>
}

/** Finds an executable on PATH (honouring PATHEXT on Windows) so node-pty gets a full path. */
export function findOnPath(cmd: string): string {
  if (isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) return cmd
  const exts = process.platform === 'win32' ? (process.env['PATHEXT'] ?? '.EXE;.CMD').split(';') : ['']
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    for (const ext of extname(cmd) ? [''] : exts) {
      const candidate = join(dir, cmd + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  throw new Error(`${cmd} not found on PATH`)
}

/**
 * Starts a pseudo-terminal running `spec` (default: the user's shell) and streams it to `wc`.
 * `tap` sees every chunk of output first, e.g. to read a debugger's listening URL.
 */
export function startPty(
  wc: WebContents,
  cwd: string,
  cols: number,
  rows: number,
  spec?: PtySpec,
  tap?: (data: string) => void
): number {
  const file = spec ? findOnPath(spec.file) : process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? '/bin/bash')
  const id = nextId++
  const term = pty.spawn(file, spec?.args ?? [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, ...spec?.env } as Record<string, string>
  })
  term.onData((data) => {
    tap?.(data)
    if (!wc.isDestroyed()) wc.send('term:data', id, data)
  })
  term.onExit(({ exitCode }) => {
    terms.delete(id)
    if (!wc.isDestroyed()) wc.send('term:exit', id, exitCode)
  })
  terms.set(id, term)
  return id
}

export function registerTerminal(): void {
  ipcMain.handle('term:create', (e, cwd: string, cols: number, rows: number, spec?: PtySpec) =>
    startPty(e.sender, cwd, cols, rows, spec)
  )
  ipcMain.handle('term:write', (_e, id: number, data: string) => getTerm(id).write(data))
  ipcMain.handle('term:resize', (_e, id: number, cols: number, rows: number) => getTerm(id).resize(cols, rows))
  ipcMain.handle('term:kill', (_e, id: number) => getTerm(id).kill())
}

export function killAllTerminals(): void {
  for (const t of terms.values()) t.kill()
  terms.clear()
}
