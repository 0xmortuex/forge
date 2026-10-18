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

/** One shell session shown in `container`. Starts lazily on first show(); restarts after the shell exits. */
export function createTerminalView(
  container: HTMLElement,
  getCwd: () => string | null,
  guard: (label: string, fn: () => Promise<void>) => Promise<void>
): { show: () => void } {
  let term: Terminal | null = null
  let fit: FitAddon | null = null
  let id: number | null = null
  let starting = false

  const fitNow = (): void => {
    if (term && fit && container.offsetParent !== null) fit.fit()
  }
  new ResizeObserver(fitNow).observe(container)

  window.forge.onTermData((tid, data) => {
    if (tid === id) term?.write(data)
  })
  window.forge.onTermExit((tid, code) => {
    if (tid !== id) return
    id = null
    term?.write(`\r\n\x1b[90m[process exited with code ${code} — reopen the terminal to start a new one]\x1b[0m\r\n`)
  })

  async function start(): Promise<void> {
    const cwd = getCwd()
    if (!cwd) throw new Error('Open a folder first (Ctrl+O) — the terminal starts in the project folder')
    if (!term) {
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
    } else term.clear()
    fit?.fit()
    id = await window.forge.termCreate(cwd, term.cols, term.rows)
  }

  return {
    show(): void {
      if (id === null && !starting) {
        starting = true
        void guard('Terminal', start).finally(() => (starting = false))
      }
      requestAnimationFrame(() => {
        fitNow()
        term?.focus()
      })
    }
  }
}
