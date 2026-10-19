import { icons } from './icons'
import { createTerminalView, shellSpec, type TerminalView } from './terminal'
import { askText } from './menu'

interface Pane {
  name: string
  el: HTMLElement
  view: TerminalView
  exited: boolean
}

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
export function initTerminals(deps: TerminalsDeps): { show: () => void; newTerminal: (cwd?: string) => void } {
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
      tab.className = 'ttab' + (p === active ? ' active' : '') + (p.exited ? ' exited' : '') + (seen.has(p) ? '' : ' enter')
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
    tabsEl.append(add)
  }

  function activate(p: Pane | null): void {
    active = p
    for (const q of panes) q.el.hidden = q !== p
    render()
    p?.view.show()
  }

  async function closePane(p: Pane): Promise<void> {
    const i = panes.indexOf(p)
    if (i < 0) return
    panes.splice(i, 1)
    await p.view.dispose()
    p.el.remove()
    if (active === p) activate(panes[Math.min(i, panes.length - 1)] ?? null)
    else render()
  }

  function newTerminal(startIn?: string): void {
    const cwd = startIn ?? deps.getCwd()
    const el = document.createElement('div')
    el.className = 'term-pane'
    host.append(el)
    counter++
    const pane: Pane = {
      name: counter === 1 ? 'Local' : `Local (${counter})`,
      el,
      exited: false,
      view: createTerminalView(el, deps.getCwd, deps.guard, {
        autoStart: false,
        exitMessage: (code) => `process exited with code ${code}`,
        onExit: () => {
          pane.exited = true
          render()
        }
      })
    }
    panes.push(pane)
    activate(pane)
    void deps
      .guard('Terminal', async () => {
        if (!cwd) throw new Error('Open a folder first (Ctrl+O) — the terminal starts in the project folder')
        await pane.view.begin((cols, rows) => window.forge.termCreate(cwd, cols, rows, shellSpec()))
      })
      .catch(async () => {
        // The error is already reported; don't leave a dead empty tab behind.
        await closePane(pane)
      })
  }

  return {
    newTerminal,
    show(): void {
      if (!panes.length) newTerminal()
      else active?.view.show()
    }
  }
}
