import type { BreakpointApi } from './debug'
import { fileIcon } from './icons'

// The Breakpoints window: every breakpoint in the project with its condition or log message, switch each on or off,
// edit, remove, or remove all.

export interface BreakpointsDeps {
  /** The window's own root element. */
  root: HTMLElement
  api: BreakpointApi
  relPath: (p: string) => string
  openAt: (path: string, line: number) => Promise<void>
  /** Told how many there are (for a badge). */
  onCount: (n: number) => void
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function initBreakpointsWindow(d: BreakpointsDeps): void {
  const bar = document.createElement('div')
  bar.className = 'tool-bar'
  const title = document.createElement('span')
  title.className = 'tool-title'
  title.textContent = 'Breakpoints'
  const clear = document.createElement('button')
  clear.className = 'btn'
  clear.textContent = 'Remove All'
  clear.onclick = () => {
    if (d.api.all().length && confirm('Remove every breakpoint?')) d.api.removeAll()
  }
  bar.append(title, clear)
  const list = document.createElement('div')
  list.className = 'tool-list'
  list.id = 'bp-list'
  d.root.replaceChildren(bar, list)

  function draw(): void {
    const all = d.api.all()
    d.onCount(all.length)
    list.replaceChildren()
    if (!all.length) {
      const h = document.createElement('div')
      h.className = 'hint'
      h.textContent = 'No breakpoints. Click the gutter beside a line (or press Ctrl+F8) to add one; right-click it for conditions and logpoints.'
      list.append(h)
      return
    }
    for (const b of all) {
      const row = document.createElement('div')
      row.className = 'bprow' + (b.disabled ? ' off' : '')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = !b.disabled
      box.onclick = (e) => e.stopPropagation()
      box.onchange = () => d.api.setEnabled(b.path, b.line, box.checked)
      const dot = document.createElement('span')
      dot.className = 'bpdot ' + (b.logMessage ? 'log' : b.condition ? 'cond' : '')
      const where = document.createElement('span')
      where.className = 'bpwhere'
      where.textContent = `${basename(b.path)}:${b.line}`
      const what = document.createElement('span')
      what.className = 'bpwhat'
      what.textContent = b.logMessage ? `logs "${b.logMessage}"` : b.condition ? `if ${b.condition}` : d.relPath(b.path)
      const edit = document.createElement('button')
      edit.className = 'icon-btn small'
      edit.title = 'Edit condition (Shift-click: log message)'
      edit.textContent = '✎'
      edit.onclick = (e) => {
        e.stopPropagation()
        void (e.shiftKey ? d.api.editLog(b.path, b.line) : d.api.editCondition(b.path, b.line))
      }
      const del = document.createElement('button')
      del.className = 'icon-btn small'
      del.title = 'Remove'
      del.textContent = '✕'
      del.onclick = (e) => {
        e.stopPropagation()
        d.api.remove(b.path, b.line)
      }
      row.insertAdjacentHTML('beforeend', fileIcon(basename(b.path)))
      row.append(box, dot, where, what, edit, del)
      row.onclick = () => void d.openAt(b.path, b.line).catch(() => undefined) // reported by the opener
      list.append(row)
    }
  }
  d.api.onChange(draw)
  draw()
}
