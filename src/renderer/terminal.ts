import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { settings } from './settings'

// Set from the active theme (see themes.ts); until then, a neutral dark default.
let currentTheme: ITheme = { background: '#263238', foreground: '#b0bec5', cursor: '#26c6b0' }

export interface TerminalSettings {
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: 'block' | 'bar' | 'underline'
  cursorBlink: boolean
  scrollback: number
}
let currentSettings: TerminalSettings = {
  fontFamily: '"Cascadia Mono", Consolas, monospace',
  fontSize: 13,
  lineHeight: 1,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 5000
}

/** Every terminal that exists right now, so theme/option changes reach all of them. */
const live = new Map<Terminal, FitAddon>()

export function setTerminalTheme(theme: ITheme): void {
  currentTheme = theme
  for (const term of live.keys()) term.options.theme = theme
}

export function setTerminalSettings(patch: Partial<TerminalSettings>): void {
  currentSettings = { ...currentSettings, ...patch }
  for (const [term, fit] of live) {
    Object.assign(term.options, currentSettings)
    // The cell size may have changed. A hidden terminal can't measure itself; it refits when shown again.
    if (term.element && term.element.offsetParent !== null) fit.fit()
  }
}

export interface TerminalView {
  /** Shows the view; a shell view with autoStart starts its shell the first time. */
  show: () => void
  /** Clears the screen and starts whatever `create` spawns, replacing any running process. */
  begin: (create: (cols: number, rows: number) => Promise<number>) => Promise<void>
  /** Kills the running process, if any. */
  kill: () => Promise<void>
  isRunning: () => boolean
  /** Types text into the running process, as if the user had typed it (end a command with a carriage return). */
  write: (data: string) => void
  /** Kills the process, removes listeners and disposes the xterm. The view is unusable afterwards. */
  dispose: () => Promise<void>
}

export interface TerminalOptions {
  /** Start the user's shell on first show(). Off for views driven by begin() (e.g. Run). */
  autoStart: boolean
  exitMessage: (code: number) => string
  onExit?: (code: number) => void
}

/**
 * Keys that belong to the IDE rather than the shell: tool windows (Alt+digit), the palette, settings, find, zen mode
 * and the F-keys. xterm would swallow them while the terminal has focus, so it is told to leave them alone.
 */
function isAppShortcut(e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return false
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit\d$/.test(e.code)) return true
  if (/^F\d+$/.test(e.key)) return true
  if (!e.ctrlKey && !e.metaKey) return false
  if (e.code === 'Comma' || e.code === 'Backquote' || e.code === 'Tab' || e.code === 'PageDown' || e.code === 'PageUp') return true
  if (e.altKey) return e.code === 'KeyZ' || e.code === 'KeyS'
  return e.shiftKey && (e.code === 'KeyP' || e.code === 'KeyF')
}

/** The shell chosen in Settings, as something to start; undefined = the system default. */
export function shellSpec(): { file: string; args: string[] } | undefined {
  const choice = settings.get<string>('terminalShell')
  return choice === 'default' ? undefined : { file: choice === 'powershell' ? 'powershell.exe' : choice === 'cmd' ? 'cmd.exe' : choice === 'wsl' ? 'wsl.exe' : choice, args: [] }
}

/** One pty-backed xterm shown in `container`. */
export function createTerminalView(
  container: HTMLElement,
  getCwd: () => string | null,
  guard: (label: string, fn: () => Promise<void>) => Promise<void>,
  opts: TerminalOptions = {
    autoStart: true,
    exitMessage: (code) => `process exited with code ${code} — reopen the terminal to start a new one`
  }
): TerminalView {
  let term: Terminal | null = null
  let fit: FitAddon | null = null
  let id: number | null = null
  let starting = false

  const fitNow = (): void => {
    if (term && fit && container.offsetParent !== null) fit.fit()
  }
  const observer = new ResizeObserver(fitNow)
  observer.observe(container)

  const offData = window.forge.onTermData((tid, data) => {
    if (tid === id) term?.write(data)
  })
  const offExit = window.forge.onTermExit((tid, code) => {
    if (tid !== id) return
    id = null
    term?.write(`\r\n\x1b[90m[${opts.exitMessage(code)}]\x1b[0m\r\n`)
    opts.onExit?.(code)
  })

  function ensureTerm(): Terminal {
    if (term) return term
    term = new Terminal({ ...currentSettings, theme: currentTheme, allowProposedApi: false })
    fit = new FitAddon()
    term.loadAddon(fit)
    live.set(term, fit)
    term.open(container)
    term.attachCustomKeyEventHandler((e) => !isAppShortcut(e)) // false = xterm ignores it and it reaches the app
    term.onData((data) => {
      if (id !== null) void window.forge.termWrite(id, data)
    })
    term.onResize(({ cols, rows }) => {
      if (id !== null) void window.forge.termResize(id, cols, rows)
    })
    return term
  }

  async function kill(): Promise<void> {
    if (id === null) return
    const old = id
    id = null // the old process's output and exit are ignored from here on
    await window.forge.termKill(old)
  }

  async function begin(create: (cols: number, rows: number) => Promise<number>): Promise<void> {
    await kill()
    const t = ensureTerm()
    t.clear()
    fit?.fit()
    id = await create(t.cols, t.rows)
  }

  function startShell(): Promise<void> {
    const cwd = getCwd()
    if (!cwd) throw new Error('Open a folder first (Ctrl+O) — the terminal starts in the project folder')
    return begin((cols, rows) => window.forge.termCreate(cwd, cols, rows, shellSpec()))
  }

  return {
    show(): void {
      if (opts.autoStart && id === null && !starting) {
        starting = true
        void guard('Terminal', startShell).finally(() => (starting = false))
      }
      requestAnimationFrame(() => {
        fitNow()
        term?.focus()
      })
    },
    begin,
    kill,
    isRunning: () => id !== null,
    write: (data) => {
      if (id !== null) void window.forge.termWrite(id, data)
    },
    dispose: async () => {
      await kill()
      offData()
      offExit()
      observer.disconnect()
      if (term) live.delete(term)
      term?.dispose()
      term = null
    }
  }
}
