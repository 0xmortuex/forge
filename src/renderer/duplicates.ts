import type { DupGroup, DupResult } from '../main/duplicates'

// The Duplicates window: copy-pasted code found across the project. Each group is a block that appears in several places; open
// a group to see the code and every place it occurs, and click a place to go there.

export interface DuplicatesDeps {
  /** The window's own root element. */
  root: HTMLElement
  getRoot: () => string | null
  relPath: (path: string) => string
  openAt: (path: string, line: number) => Promise<void>
  /** Brings the window on screen. */
  reveal: () => void
  /** Called with the number of duplicated blocks after a scan (for a badge). */
  onCount: (groups: number) => void
  report: (msg: string, isError?: boolean) => void
}

export interface DuplicatesView {
  scan: () => Promise<void>
}

const MIN_LINES = [4, 6, 10, 20]

export function initDuplicates(d: DuplicatesDeps): DuplicatesView {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  const bar = el('div', 'tool-bar')
  const title = el('span', 'tool-title', 'Duplicated code')
  const status = el('span', 'dup-status')
  status.id = 'dup-status'
  const minSel = el('select', 'field dup-min')
  minSel.id = 'dup-min'
  minSel.title = 'Shortest block that counts as a duplicate'
  for (const n of MIN_LINES) {
    const o = el('option', '', `${n}+ lines`)
    o.value = String(n)
    minSel.append(o)
  }
  minSel.value = '6'
  const scan = el('button', 'btn-primary', 'Scan Project')
  scan.id = 'dup-scan'
  bar.append(title, status, minSel, scan)
  const list = el('div', 'tool-list dup-list')
  list.id = 'dup-list'
  d.root.replaceChildren(bar, list)

  const open = new Set<number>()
  let result: DupResult | null = null

  function draw(): void {
    list.replaceChildren()
    if (!result) {
      list.append(el('div', 'hint', 'Scan the project to find copy-pasted blocks of code.'))
      return
    }
    if (!result.groups.length) {
      list.append(el('div', 'hint', `No duplicated blocks of ${minSel.value}+ lines in ${result.filesScanned} files.`))
      return
    }
    result.groups.forEach((g: DupGroup, i) => {
      const head = el('div', `dup-group${open.has(i) ? ' open' : ''}`)
      head.dataset['group'] = String(i)
      head.append(el('span', 'dup-chev', open.has(i) ? '▾' : '▸'), el('span', 'dup-title', `${g.occurrences.length}× ${g.lines} lines`))
      head.append(el('span', 'dup-where', g.occurrences.map((o) => d.relPath(o.path).split(/[\\/]/).pop()).join(', ')))
      head.onclick = () => {
        if (open.has(i)) open.delete(i)
        else open.add(i)
        draw()
      }
      list.append(head)
      if (!open.has(i)) return
      list.append(el('pre', 'dup-sample', g.sample))
      for (const o of g.occurrences) {
        const row = el('div', 'dup-occ')
        row.append(el('span', 'dup-path', d.relPath(o.path)), el('span', 'dup-range', `${o.startLine}–${o.endLine}`))
        row.onclick = () => void d.openAt(o.path, o.startLine).catch(() => undefined) // reported by the opener
        list.append(row)
      }
    })
  }

  async function run(): Promise<void> {
    const root = d.getRoot()
    if (!root) throw new Error('Open a folder first (Ctrl+O)')
    d.reveal()
    scan.disabled = true
    status.classList.remove('err')
    status.textContent = 'Scanning…'
    try {
      result = await window.forge.findDuplicates(root, Number(minSel.value))
      open.clear()
      const dupLines = result.groups.reduce((n, g) => n + g.lines * (g.occurrences.length - 1), 0)
      status.textContent = result.groups.length
        ? `${result.groups.length} duplicated block${result.groups.length === 1 ? '' : 's'}${result.truncated ? '+' : ''}, ${dupLines.toLocaleString()} redundant lines, ${result.filesScanned} files scanned`
        : `${result.filesScanned} files scanned`
      d.onCount(result.groups.length)
    } catch (err) {
      result = null
      const msg = (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
      status.textContent = msg
      status.classList.add('err')
      throw new Error(msg)
    } finally {
      scan.disabled = false
      draw()
    }
  }

  scan.onclick = () => void run().catch((err: unknown) => d.report(`Duplicates: ${err instanceof Error ? err.message : String(err)}`, true))
  draw()
  return { scan: run }
}
