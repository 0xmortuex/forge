import * as monaco from 'monaco-editor'
import { fileIcon } from './icons'
import type { InspectResult } from '../main/inspect'

// The Problems window: every diagnostic of the open files, grouped by file. It reads Monaco's markers, so whatever
// reports them (the language servers today) shows up here.

export interface ProblemsDeps {
  /** The window's own root element. */
  root: HTMLElement
  relPath: (path: string) => string
  openAt: (path: string, line: number, column: number) => Promise<void>
  /** Told the totals after every change (for the badge and the status bar). */
  onCounts: (errors: number, warnings: number, infos: number) => void
  /** Runs the project checkers (tsc, ESLint); rejects with a readable message when there is nothing to run. */
  inspect: () => Promise<InspectResult>
  /** Told when the button's inspection fails (nothing to run, a checker crashed). */
  onError: (err: unknown) => void
}

const MS = monaco.MarkerSeverity
type Level = 'error' | 'warning' | 'info'
const level = (s: monaco.MarkerSeverity): Level => (s === MS.Error ? 'error' : s === MS.Warning ? 'warning' : 'info')
const GLYPH: Record<Level, string> = { error: '✕', warning: '⚠', info: 'ℹ' }
const LABEL: Record<Level, string> = { error: 'Errors', warning: 'Warnings', info: 'Info' }

export interface ProblemsView {
  refresh: () => void
  /** Runs the project inspection and shows its results below the open files' problems. */
  inspect: () => Promise<void>
}

export function initProblems(deps: ProblemsDeps): ProblemsView {
  const bar = document.createElement('div')
  bar.className = 'tool-bar'
  const list = document.createElement('div')
  list.id = 'problems-list'
  list.className = 'tool-list'
  deps.root.replaceChildren(bar, list)
  const inspectBtn = document.createElement('button')
  inspectBtn.id = 'problems-inspect'
  inspectBtn.className = 'btn'
  inspectBtn.textContent = 'Inspect Code'
  inspectBtn.title = 'Run tsc and ESLint over the whole project'

  const shown: Record<Level, boolean> = { error: true, warning: true, info: true }
  const counts: Record<Level, number> = { error: 0, warning: 0, info: 0 }
  const folded = new Set<string>()
  let inspection: InspectResult | null = null
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
  bar.append(inspectBtn)

  /** One problem as the list shows it, whether it came from an open file's markers or from a project inspection. */
  interface Item { path: string; line: number; col: number; level: Level; message: string; where: string }

  function section(items: Item[], title: string | null): void {
    const byFile = new Map<string, Item[]>()
    for (const it of items) {
      const group = byFile.get(it.path) ?? []
      group.push(it)
      byFile.set(it.path, group)
    }
    if (title !== null && byFile.size) {
      const h = document.createElement('div')
      h.className = 'psection'
      h.textContent = title
      list.append(h)
    }
    const files = [...byFile.entries()].sort(
      ([pa, a], [pb, b]) => b.filter((m) => m.level === 'error').length - a.filter((m) => m.level === 'error').length || pa.localeCompare(pb)
    )
    for (const [path, group] of files) {
      const key = `${title ?? ''}|${path}`
      const head = document.createElement('div')
      head.className = 'pfile'
      head.innerHTML = fileIcon(path.split(/[\\/]/).pop() ?? path)
      const name = document.createElement('span')
      name.className = 'pname'
      name.textContent = deps.relPath(path)
      const count = document.createElement('span')
      count.className = 'pcount'
      count.textContent = String(group.length)
      head.append(name, count)
      const open = !folded.has(key)
      head.classList.toggle('closed', !open)
      head.onclick = () => {
        if (folded.has(key)) folded.delete(key)
        else folded.add(key)
        draw()
      }
      list.append(head)
      if (!open) continue
      for (const m of [...group].sort((a, b) => a.line - b.line || a.col - b.col)) {
        const row = document.createElement('div')
        row.className = `prob ${m.level}`
        row.dataset['line'] = String(m.line)
        const icon = document.createElement('span')
        icon.className = 'pico'
        icon.textContent = GLYPH[m.level]
        const msg = document.createElement('span')
        msg.className = 'pmsg'
        msg.textContent = m.message
        const where = document.createElement('span')
        where.className = 'pwhere'
        where.textContent = m.where
        row.append(icon, msg, where)
        row.onclick = () => void deps.openAt(path, m.line, m.col).catch(() => undefined) // reported by the opener
        list.append(row)
      }
    }
  }

  function draw(): void {
    // Typos are shown in the editor only: they would bury the real problems in this list.
    const all = monaco.editor.getModelMarkers({}).filter((m) => m.resource.scheme === 'file' && m.owner !== 'spell')
    counts.error = counts.warning = counts.info = 0
    const open: Item[] = []
    for (const m of all) {
      const l = level(m.severity)
      counts[l]++
      if (!shown[l]) continue
      const code = m.code ? String(typeof m.code === 'object' ? m.code.value : m.code) + ' ' : ''
      open.push({ path: m.resource.fsPath, line: m.startLineNumber, col: m.startColumn, level: l, message: m.message, where: `${m.source ? m.source + ' ' : ''}${code}[${m.startLineNumber}:${m.startColumn}]` })
    }
    for (const l of ['error', 'warning', 'info'] as const) toggles[l].textContent = `${GLYPH[l]} ${LABEL[l]} ${counts[l]}`
    deps.onCounts(counts.error, counts.warning, counts.info)

    const project: Item[] = (inspection?.problems ?? [])
      .map((p) => ({ path: p.path, line: p.line, col: p.col, level: p.severity, message: p.message, where: `${p.source} ${p.code ? p.code + ' ' : ''}[${p.line}:${p.col}]` }))
      .filter((p) => shown[p.level])

    list.replaceChildren()
    section(open, inspection ? 'Open files' : null)
    if (inspection) section(project, `Project analysis · ${inspection.ran.join(', ')} · ${inspection.problems.length} problem${inspection.problems.length === 1 ? '' : 's'}`)
    if (!open.length && !project.length) {
      const hint = document.createElement('div')
      hint.className = 'hint'
      hint.textContent = all.length || inspection?.problems.length ? 'Everything is hidden by the filters above' : inspection ? 'The project analysis found no problems' : 'No problems in the open files. Use Inspect Code to check the whole project.'
      list.append(hint)
    }
  }

  async function inspect(): Promise<void> {
    inspectBtn.disabled = true
    inspectBtn.textContent = 'Inspecting…'
    try {
      inspection = await deps.inspect()
      draw()
    } finally {
      inspectBtn.disabled = false
      inspectBtn.textContent = 'Inspect Code'
    }
  }

  let timer: number | undefined
  const later = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(draw, 120)
  }
  monaco.editor.onDidChangeMarkers(later)
  draw()
  inspectBtn.onclick = () => void inspect().catch((err: unknown) => deps.onError(err))
  return { refresh: draw, inspect }
}
