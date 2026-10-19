import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, extname, isAbsolute, join } from 'node:path'
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

/** "git-bash" means the bash that ships with Git for Windows; everything else is looked up on PATH. */
function resolveProgram(name: string): string {
  if (name !== 'git-bash') return findOnPath(name)
  const git = findOnPath('git') // ...\Git\cmd\git.exe (or ...\bin\git.exe)
  const root = dirname(dirname(git))
  for (const rel of [join('bin', 'bash.exe'), join('usr', 'bin', 'bash.exe')]) {
    const candidate = join(root, rel)
    if (existsSync(candidate)) return candidate
  }
  throw new Error('Git Bash was not found next to git. Install Git for Windows, or choose another shell in Settings.')
}

/**
 * Starts a pseudo-terminal running `spec` (default: the user's shell) and streams it to `wc`.
 * `tap` sees every chunk of output first, e.g. to read a debugger's listening URL;
 * `onExit` runs when the process ends.
 */
export function startPty(
  wc: WebContents,
  cwd: string,
  cols: number,
  rows: number,
  spec?: PtySpec,
  tap?: (data: string) => void,
  onExit?: (code: number) => void
): number {
  const file = spec ? resolveProgram(spec.file) : process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? '/bin/bash')
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
    onExit?.(exitCode)
    if (!wc.isDestroyed()) wc.send('term:exit', id, exitCode)
  })
  terms.set(id, term)
  return id
}

/**
 * Ends a pty's whole process tree. On Windows node-pty's own kill() only closes the pseudo-console,
 * which neither stops a program that is paused in a debugger nor shuts down safely while the app
 * is quitting (it crashed natively in testing). taskkill /T /F is immediate and covers children;
 * node-pty then sees the process exit and cleans up through its normal path.
 */
function killTree(t: pty.IPty): void {
  if (process.platform !== 'win32') return t.kill()
  const res = spawnSync('taskkill', ['/PID', String(t.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' })
  // 128 = the process already exited, which is exactly what we wanted.
  if (res.status !== 0 && res.status !== 128) {
    throw new Error(`taskkill failed (exit ${res.status}): ${(res.stderr || res.stdout).trim()}`)
  }
}

export function registerTerminal(): void {
  ipcMain.handle('term:create', (e, cwd: string, cols: number, rows: number, spec?: PtySpec) =>
    startPty(e.sender, cwd, cols, rows, spec)
  )
  ipcMain.handle('term:write', (_e, id: number, data: string) => getTerm(id).write(data))
  ipcMain.handle('term:resize', (_e, id: number, cols: number, rows: number) => getTerm(id).resize(cols, rows))
  ipcMain.handle('term:kill', (_e, id: number) => killTree(getTerm(id)))
}

/**
 * Ends every terminal and resolves once node-pty has seen them exit (or after a short wait). Quitting while a
 * pseudo-console is still being torn down crashes natively on some Windows machines, so the app waits for this.
 */
export function killAllTerminals(): Promise<void> {
  const all = [...terms.values()]
  if (!all.length) return Promise.resolve()
  const exited = Promise.all(all.map((t) => new Promise<void>((resolve) => t.onExit(() => resolve()))))
  for (const t of all) killTree(t)
  return Promise.race([exited.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 1500))])
}
