import * as monaco from 'monaco-editor'
import { fileIcon } from './icons'

// The Problems window: every diagnostic of the open files, grouped by file. It reads Monaco's markers, so whatever
// reports them (the language servers today) shows up here.

export interface ProblemsDeps {
  /** The window's own root element. */
  root: HTMLElement
  relPath: (path: string) => string
  openAt: (path: string, line: number, column: number) => Promise<void>
  /** Told the totals after every change (for the badge and the status bar). */
  onCounts: (errors: number, warnings: number, infos: number) => void
}

const MS = monaco.MarkerSeverity
type Level = 'error' | 'warning' | 'info'
const level = (s: monaco.MarkerSeverity): Level => (s === MS.Error ? 'error' : s === MS.Warning ? 'warning' : 'info')
const GLYPH: Record<Level, string> = { error: '✕', warning: '⚠', info: 'ℹ' }
const LABEL: Record<Level, string> = { error: 'Errors', warning: 'Warnings', info: 'Info' }

export interface ProblemsView {
  refresh: () => void
}

export function initProblems(deps: ProblemsDeps): ProblemsView {
  const bar = document.createElement('div')
  bar.className = 'tool-bar'
  const list = document.createElement('div')
  list.id = 'problems-list'
  list.className = 'tool-list'
  deps.root.replaceChildren(bar, list)

  const shown: Record<Level, boolean> = { error: true, warning: true, info: true }
  const counts: Record<Level, number> = { error: 0, warning: 0, info: 0 }
  const folded = new Set<string>()
  const toggles = {} as Record<Level, HTMLButtonElement>
  for (const l of ['error', 'warning', 'info'] as const) {
    const b = document.createElement('button')
    b.className = `chip ${l} on`
    b.onclick = () => {
      shown[l] = !shown[l]
      b.classList.toggle('on', shown[l])
      draw()
    }
    toggles[l] = b
    bar.append(b)
  }

  function draw(): void {
    const all = monaco.editor.getModelMarkers({}).filter((m) => m.resource.scheme === 'file')
    counts.error = counts.warning = counts.info = 0
    const byFile = new Map<string, monaco.editor.IMarker[]>()
    for (const m of all) {
      const l = level(m.severity)
      counts[l]++
      if (!shown[l]) continue
      const path = m.resource.fsPath
      const group = byFile.get(path) ?? []
      group.push(m)
      byFile.set(path, group)
    }
    for (const l of ['error', 'warning', 'info'] as const) toggles[l].textContent = `${GLYPH[l]} ${LABEL[l]} ${counts[l]}`
    deps.onCounts(counts.error, counts.warning, counts.info)

    list.replaceChildren()
    if (!byFile.size) {
      const hint = document.createElement('div')
      hint.className = 'hint'
      hint.textContent = all.length ? 'Everything is hidden by the filters above' : 'No problems in the open files'
      list.append(hint)
      return
    }
    const files = [...byFile.entries()].sort(
      ([pa, a], [pb, b]) =>
        b.filter((m) => m.severity === MS.Error).length - a.filter((m) => m.severity === MS.Error).length || pa.localeCompare(pb)
    )
    for (const [path, markers] of files) {
      const head = document.createElement('div')
      head.className = 'pfile'
      head.innerHTML = fileIcon(path.split(/[\\/]/).pop() ?? path)
      const name = document.createElement('span')
      name.className = 'pname'
      name.textContent = deps.relPath(path)
      const count = document.createElement('span')
      count.className = 'pcount'
      count.textContent = String(markers.length)
      head.append(name, count)
      const open = !folded.has(path)
      head.classList.toggle('closed', !open)
      head.onclick = () => {
        if (folded.has(path)) folded.delete(path)
        else folded.add(path)
        draw()
      }
      list.append(head)
      if (!open) continue
      for (const m of [...markers].sort((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn)) {
        const row = document.createElement('div')
        const l = level(m.severity)
        row.className = `prob ${l}`
        row.dataset['line'] = String(m.startLineNumber)
        const icon = document.createElement('span')
        icon.className = 'pico'
        icon.textContent = GLYPH[l]
        const msg = document.createElement('span')
        msg.className = 'pmsg'
        msg.textContent = m.message
        const where = document.createElement('span')
        where.className = 'pwhere'
        where.textContent = `${m.source ? m.source + ' ' : ''}${m.code ? String(typeof m.code === 'object' ? m.code.value : m.code) + ' ' : ''}[${m.startLineNumber}:${m.startColumn}]`
        row.append(icon, msg, where)
        row.onclick = () => void deps.openAt(path, m.startLineNumber, m.startColumn).catch(() => undefined) // reported by the opener
        list.append(row)
      }
    }
  }

  let timer: number | undefined
  const later = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(draw, 120)
  }
  monaco.editor.onDidChangeMarkers(later)
  draw()
  return { refresh: draw }
}
