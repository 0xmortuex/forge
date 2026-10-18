import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const THEME = {
  background: '#263238',
  foreground: '#b0bec5',
  cursor: '#26c6b0',
  selectionBackground: '#2f5560',
  black: '#37474f', red: '#f07178', green: '#c3e88d', yellow: '#ffcb6b',
  blue: '#82aaff', magenta: '#c792ea', cyan: '#89ddff', white: '#b0bec5',
  brightBlack: '#546e7a', brightRed: '#ff8b92', brightGreen: '#ddffa7', brightYellow: '#ffe585',
  brightBlue: '#9cc4ff', brightMagenta: '#e1acff', brightCyan: '#a3f7ff', brightWhite: '#eeffff'
}

export interface TerminalView {
  /** Shows the view; a shell view with autoStart starts its shell the first time. */
  show: () => void
  /** Clears the screen and starts whatever `create` spawns, replacing any running process. */
  begin: (create: (cols: number, rows: number) => Promise<number>) => Promise<void>
  /** Kills the running process, if any. */
  kill: () => Promise<void>
  isRunning: () => boolean
  /** Kills the process, removes listeners and disposes the xterm. The view is unusable afterwards. */
  dispose: () => Promise<void>
}

export interface TerminalOptions {
  /** Start the user's shell on first show(). Off for views driven by begin() (e.g. Run). */
  autoStart: boolean
  exitMessage: (code: number) => string
  onExit?: (code: number) => void
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
    term = new Terminal({
      theme: THEME,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: false
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
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
    return begin((cols, rows) => window.forge.termCreate(cwd, cols, rows))
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
    dispose: async () => {
      await kill()
      offData()
      offExit()
      observer.disconnect()
      term?.dispose()
      term = null
    }
  }
}
