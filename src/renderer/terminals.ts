import { icons } from './icons'
import { createTerminalView, shellSpec, type TerminalView } from './terminal'
import { askText } from './menu'

/** One shell. A tab (Pane) holds one or more of them side by side. */
interface Cell {
  el: HTMLElement
  view: TerminalView
  exited: boolean
}

interface Pane {
  name: string
  el: HTMLElement
  cells: Cell[]
  /** The folder the tab was started in, which a split starts in too. */
  cwd: string | null
  /** The cell that last had focus: it gets focus again when the tab is shown. */
  focused: Cell | null
}

const exitedPane = (p: Pane): boolean => p.cells.length > 0 && p.cells.every((c) => c.exited)

export interface TerminalsDeps {
  getCwd: () => string | null
  guard: (label: string, fn: () => Promise<void>) => Promise<void>
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

/** The Terminal tool window: any number of independent shells, one visible at a time. */
export interface NewTerminalOptions {
  /** The tab's name (default: "Local"). */
  name?: string
  /** A command line to run right away. */
  command?: string
}

export interface Terminals {
  show: () => void
  newTerminal: (cwd?: string, opts?: NewTerminalOptions) => void
  /** Starts another shell beside the one in the current tab. */
  split: () => void
}

export function initTerminals(deps: TerminalsDeps): Terminals {
  const tabsEl = byId('term-tabs')
  const host = byId('term')
  const panes: Pane[] = []
  let active: Pane | null = null
  let counter = 0
  const seen = new WeakSet<Pane>() // only tabs that are new play the entrance animation

  function render(): void {
    tabsEl.replaceChildren()
    for (const p of panes) {
      const tab = document.createElement('div')
      tab.className = 'ttab' + (p === active ? ' active' : '') + (exitedPane(p) ? ' exited' : '') + (seen.has(p) ? '' : ' enter')
      seen.add(p)
      const name = document.createElement('span')
      name.className = 'tname'
      name.textContent = p.name
      const close = document.createElement('span')
      close.className = 'close'
      close.innerHTML = icons.close
      close.onclick = (e) => {
        e.stopPropagation()
        void closePane(p)
      }
      tab.append(name, close)
      tab.onclick = () => activate(p)
      tab.ondblclick = () => {
        void askText('Rename terminal', p.name).then((n) => {
          if (n) {
            p.name = n
            render()
          }
        })
      }
      tabsEl.append(tab)
    }
    const add = document.createElement('button')
    add.id = 'term-new'
    add.title = 'New terminal (Ctrl+Shift+`)'
    add.textContent = '+'
    add.onclick = () => newTerminal()
    const split = document.createElement('button')
    split.id = 'term-split'
    split.title = 'Split terminal'
    split.innerHTML = icons.split
    split.onclick = () => splitActive()
    tabsEl.append(add, split)
  }

  function activate(p: Pane | null): void {
    active = p
    for (const q of panes) q.el.hidden = q !== p
    render()
    for (const c of p?.cells ?? []) c.view.show()
    p?.focused?.view.show()
  }

  async function closePane(p: Pane): Promise<void> {
    const i = panes.indexOf(p)
    if (i < 0) return
    panes.splice(i, 1)
    await Promise.all(p.cells.map((c) => c.view.dispose()))
    p.el.remove()
    if (active === p) activate(panes[Math.min(i, panes.length - 1)] ?? null)
    else render()
  }

  /** Adds a shell to the tab. A shell in a split that exits closes its half; the last one stays to show how it ended. */
  function addCell(pane: Pane): Cell {
    const el = document.createElement('div')
    el.className = 'term-cell'
    pane.el.append(el)
    const cell: Cell = {
      el,
      exited: false,
      view: createTerminalView(el, deps.getCwd, deps.guard, {
        autoStart: false,
        exitMessage: (code) => `process exited with code ${code}`,
        onExit: () => {
          cell.exited = true
          if (pane.cells.length > 1) void removeCell(pane, cell)
          else render()
        }
      })
    }
    el.addEventListener('focusin', () => (pane.focused = cell))
    pane.cells.push(cell)
    pane.focused = cell
    return cell
  }

  async function removeCell(pane: Pane, cell: Cell): Promise<void> {
    const i = pane.cells.indexOf(cell)
    if (i < 0) return
    pane.cells.splice(i, 1)
    await cell.view.dispose()
    cell.el.remove()
    if (pane.focused === cell) pane.focused = pane.cells[Math.min(i, pane.cells.length - 1)] ?? null
    render()
    if (pane === active) pane.focused?.view.show()
  }

  function start(pane: Pane, cell: Cell, opts: NewTerminalOptions = {}): void {
    void deps
      .guard('Terminal', async () => {
        if (!pane.cwd) throw new Error('Open a folder first (Ctrl+O) — the terminal starts in the project folder')
        const cwd = pane.cwd
        await cell.view.begin((cols, rows) => window.forge.termCreate(cwd, cols, rows, shellSpec()))
        if (opts.command) cell.view.write(opts.command + '\r')
      })
      .catch(async () => {
        // The error is already reported; don't leave a dead empty half or tab behind.
        if (pane.cells.length > 1) await removeCell(pane, cell)
        else await closePane(pane)
      })
  }

  function newTerminal(startIn?: string, opts: NewTerminalOptions = {}): void {
    const el = document.createElement('div')
    el.className = 'term-pane'
    host.append(el)
    counter++
    const pane: Pane = {
      name: opts.name ?? (counter === 1 ? 'Local' : `Local (${counter})`),
      el,
      cells: [],
      cwd: startIn ?? deps.getCwd(),
      focused: null
    }
    const cell = addCell(pane)
    panes.push(pane)
    activate(pane)
    start(pane, cell, opts)
  }

  function splitActive(): void {
    if (!active) return newTerminal()
    const pane = active
    const cell = addCell(pane)
    render()
    cell.view.show()
    start(pane, cell)
  }

  return {
    newTerminal,
    split: splitActive,
    show(): void {
      if (!panes.length) newTerminal()
      else active?.focused?.view.show()
    }
  }
}
