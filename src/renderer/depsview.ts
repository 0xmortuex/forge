import { foldByFolder } from '../main/depfold'
import type { DepsResult } from '../main/deps'

// The Dependencies window: the project's import graph as a layered diagram (what depends on what, left to right), by folder
// or by file, with the circular imports listed and drawn in red. Click a node to see what it imports and what imports it.

export interface DepsDeps {
  root: HTMLElement
  getRoot: () => string | null
  openFile: (path: string) => Promise<void>
  report: (msg: string, isError?: boolean) => void
}

export interface DepsView {
  refresh: () => Promise<void>
}

type Mode = 'folders' | 'files'

interface Node {
  /** Full path (files) or folder. */
  id: string
  label: string
}
interface Link {
  from: number
  to: number
  count: number
  cyclic: boolean
}

const SVG = 'http://www.w3.org/2000/svg'
const NODE_W = 200
const NODE_H = 26
const COL_GAP = 90
const ROW_GAP = 10
const MAX_DRAWN = 300

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

/** Column for every node: its depth in the graph of strongly connected groups, so a circle shares one column. */
export function layers(count: number, links: { from: number; to: number }[], groups: number[][]): number[] {
  const comp: number[] = Array.from({ length: count }, (_, i) => i)
  for (const g of groups) for (const n of g) comp[n] = g[0] as number
  const out = new Map<number, Set<number>>()
  const indeg = new Map<number, number>()
  for (let i = 0; i < count; i++) if (comp[i] === i) indeg.set(i, 0)
  for (const l of links) {
    const a = comp[l.from] as number
    const b = comp[l.to] as number
    if (a === b) continue
    const set = out.get(a) ?? new Set<number>()
    if (!set.has(b)) {
      set.add(b)
      out.set(a, set)
      indeg.set(b, (indeg.get(b) ?? 0) + 1)
    }
  }
  const layer = new Map<number, number>()
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([c]) => c)
  for (const c of queue) layer.set(c, 0)
  while (queue.length) {
    const c = queue.shift() as number
    for (const next of out.get(c) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(c) ?? 0) + 1))
      indeg.set(next, (indeg.get(next) ?? 1) - 1)
      if (indeg.get(next) === 0) queue.push(next)
    }
  }
  return Array.from({ length: count }, (_, i) => layer.get(comp[i] as number) ?? 0)
}

export function initDepsView(d: DepsDeps): DepsView {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  const bar = el('div', 'tool-bar deps-bar')
  const title = el('span', 'tool-title', 'Dependencies')
  const tabs = el('span', 'viewer-modes')
  const modeButtons = new Map<Mode, HTMLButtonElement>()
  for (const [id, label] of [['folders', 'Folders'], ['files', 'Files']] as const) {
    const b = el('button', 'viewer-mode', label)
    b.id = `deps-mode-${id}`
    b.onclick = () => {
      mode = id
      selected = null
      draw()
    }
    modeButtons.set(id, b)
    tabs.append(b)
  }
  const depth = el('select', 'field deps-depth')
  depth.id = 'deps-depth'
  depth.setAttribute('aria-label', 'Folder depth')
  for (const n of [1, 2, 3, 4]) {
    const o = el('option', '', `${n} level${n === 1 ? '' : 's'}`)
    o.value = String(n)
    depth.append(o)
  }
  depth.value = '2'
  const filter = el('input', 'field deps-filter')
  filter.id = 'deps-filter'
  filter.placeholder = 'Filter files by path'
  filter.setAttribute('aria-label', 'Filter files by path')
  filter.spellcheck = false
  const summary = el('span', 'viewer-info')
  summary.id = 'deps-summary'
  const refreshBtn = el('button', 'btn', 'Refresh')
  refreshBtn.id = 'deps-refresh'
  bar.append(title, tabs, depth, filter, summary, refreshBtn)
  const body = el('div', 'deps-body')
  const canvas = el('div', 'deps-canvas')
  canvas.id = 'deps-canvas'
  const side = el('div', 'deps-side')
  side.id = 'deps-side'
  body.append(canvas, side)
  d.root.replaceChildren(bar, body)

  let mode: Mode = 'folders'
  let result: DepsResult | null = null
  let selected: number | null = null
  let nodes: Node[] = []
  let links: Link[] = []

  const hint = (text: string, error = false): void => {
    canvas.replaceChildren(el('div', error ? 'hint err' : 'hint', text))
    side.replaceChildren()
    summary.textContent = ''
  }

  /** What is drawn now: folders or files, as nodes and links. */
  function model(r: DepsResult): void {
    const cyclicFiles = new Set(r.cycles.flat())
    const q = filter.value.trim().toLowerCase()
    if (mode === 'folders') {
      const folded = foldByFolder(r.graph, Number(depth.value))
      nodes = folded.folders.map((f) => ({ id: f, label: f }))
      // A folder pair is part of a circle when files in both belong to the same circle.
      const folderOf = (file: string): string => {
        const parts = file.split('/')
        parts.pop()
        return parts.slice(0, Number(depth.value)).join('/') || '.'
      }
      const cyclicFolderPairs = new Set<string>()
      for (const group of r.cycles) {
        const members = new Set(group)
        for (const e of r.graph.edges) {
          if (members.has(e.from) && members.has(e.to)) cyclicFolderPairs.add(`${folderOf(r.graph.files[e.from] as string)}>${folderOf(r.graph.files[e.to] as string)}`)
        }
      }
      links = folded.edges.map((e) => ({ ...e, cyclic: cyclicFolderPairs.has(`${folded.folders[e.from]}>${folded.folders[e.to]}`) }))
    } else {
      const keep = r.graph.files.map((f, i) => (!q || f.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0)
      const at = new Map(keep.map((orig, i) => [orig, i]))
      nodes = keep.map((i) => ({ id: r.graph.files[i] as string, label: (r.graph.files[i] as string).split('/').pop() as string }))
      const circleOf = new Map<number, number>()
      r.cycles.forEach((g, gi) => g.forEach((n) => circleOf.set(n, gi)))
      links = r.graph.edges
        .filter((e) => at.has(e.from) && at.has(e.to))
        .map((e) => ({ from: at.get(e.from) as number, to: at.get(e.to) as number, count: 1, cyclic: circleOf.has(e.from) && circleOf.get(e.from) === circleOf.get(e.to) }))
      void cyclicFiles
    }
  }

  function draw(): void {
    for (const [id, b] of modeButtons) b.classList.toggle('active', id === mode)
    depth.hidden = mode !== 'folders'
    filter.hidden = mode !== 'files'
    if (!result) return
    model(result)
    const cycles = result.cycles.length
    summary.textContent = `${result.graph.files.length} files · ${result.graph.edges.length} imports · ${cycles} circular import${cycles === 1 ? '' : 's'}${result.truncated ? ' (project too large: only the first files are analysed)' : ''}`
    if (!nodes.length) return void canvas.replaceChildren(el('div', 'hint', mode === 'files' ? 'No files match.' : 'No source files found.'))
    if (nodes.length > MAX_DRAWN) {
      canvas.replaceChildren(el('div', 'hint', `${nodes.length} nodes are too many to draw. Show folders, or filter the files by path.`))
      return drawSide()
    }
    // Columns by depth; inside a column, in name order.
    const groupsInView: number[][] = []
    if (mode === 'files') {
      const at = new Map(nodes.map((n, i) => [n.id, i]))
      for (const g of result.cycles) {
        const mapped = g.map((i) => at.get(result!.graph.files[i] as string)).filter((i): i is number => i !== undefined)
        if (mapped.length > 1) groupsInView.push(mapped)
      }
    }
    const layer = layers(nodes.length, links, groupsInView)
    const columns: number[][] = []
    nodes.forEach((_, i) => (columns[layer[i] as number] ??= []).push(i))
    const pos = new Map<number, { x: number; y: number }>()
    let height = 0
    columns.forEach((col, c) => {
      col?.forEach((n, row) => {
        pos.set(n, { x: 20 + c * (NODE_W + COL_GAP), y: 20 + row * (NODE_H + ROW_GAP) })
      })
      height = Math.max(height, 40 + (col?.length ?? 0) * (NODE_H + ROW_GAP))
    })
    const width = 40 + columns.length * (NODE_W + COL_GAP)
    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Import dependency diagram' })
    svg.id = 'deps-svg'
    const related = new Set<number>()
    if (selected !== null) {
      related.add(selected)
      for (const l of links) {
        if (l.from === selected) related.add(l.to)
        if (l.to === selected) related.add(l.from)
      }
    }
    for (const l of links) {
      const a = pos.get(l.from)
      const b = pos.get(l.to)
      if (!a || !b) continue
      const forward = b.x > a.x
      const x1 = forward ? a.x + NODE_W : a.x
      const x2 = forward ? b.x : b.x + NODE_W
      const y1 = a.y + NODE_H / 2
      const y2 = b.y + NODE_H / 2
      const dx = Math.max(40, Math.abs(x2 - x1) / 2)
      const dim = selected !== null && !(l.from === selected || l.to === selected)
      const path = svgEl('path', {
        d: `M${x1},${y1} C${x1 + (forward ? dx : -dx)},${y1} ${x2 - (forward ? dx : -dx)},${y2} ${x2},${y2}`,
        class: `deps-edge${l.cyclic ? ' cyclic' : ''}${dim ? ' dim' : ''}`,
        fill: 'none'
      })
      path.dataset['from'] = nodes[l.from]?.id ?? ''
      path.dataset['to'] = nodes[l.to]?.id ?? ''
      svg.append(path)
    }
    const inCircle = new Set<number>()
    for (const l of links) if (l.cyclic) (inCircle.add(l.from), inCircle.add(l.to))
    nodes.forEach((n, i) => {
      const p = pos.get(i)
      if (!p) return
      const g = svgEl('g', { class: `deps-node${i === selected ? ' selected' : ''}${inCircle.has(i) ? ' cyclic' : ''}${selected !== null && !related.has(i) ? ' dim' : ''}`, transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'button', 'aria-label': n.id })
      g.dataset['id'] = n.id
      g.append(svgEl('rect', { width: NODE_W, height: NODE_H, rx: 6 }))
      const label = svgEl('text', { x: 10, y: NODE_H / 2 + 4 })
      label.textContent = n.label.length > 28 ? `…${n.label.slice(-27)}` : n.label
      const tip = svgEl('title')
      tip.textContent = n.id
      g.append(label, tip)
      const choose = (): void => {
        selected = i
        draw()
      }
      g.onclick = choose
      g.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          choose()
        }
      }
      g.ondblclick = () => {
        const root = d.getRoot()
        if (mode === 'files' && root) void d.openFile(`${root.replace(/[\\/]$/, '')}/${n.id}`).catch(() => undefined)
      }
      svg.append(g)
    })
    const scrollLeft = canvas.scrollLeft
    const scrollTop = canvas.scrollTop
    canvas.replaceChildren(svg)
    canvas.scrollLeft = scrollLeft
    canvas.scrollTop = scrollTop
    drawSide()
  }

  function drawSide(): void {
    if (!result) return
    const r = result
    side.replaceChildren()
    if (selected !== null && nodes[selected]) {
      const n = nodes[selected] as Node
      side.append(el('h4', '', n.id))
      const imports = links.filter((l) => l.from === selected)
      const importedBy = links.filter((l) => l.to === selected)
      const list = (heading: string, items: Link[], pick: (l: Link) => number): void => {
        side.append(el('h5', '', `${heading} (${items.length})`))
        for (const l of items) {
          const other = nodes[pick(l)] as Node
          const row = el('div', `deps-row${l.cyclic ? ' cyclic' : ''}`, other.id + (l.count > 1 ? `  ×${l.count}` : ''))
          row.onclick = () => {
            selected = pick(l)
            draw()
          }
          side.append(row)
        }
      }
      list('Imports', imports, (l) => l.to)
      list('Imported by', importedBy, (l) => l.from)
    }
    side.append(el('h4', '', `Circular imports (${r.cycles.length})`))
    if (!r.cycles.length) side.append(el('div', 'hint', 'No file imports itself through a circle.'))
    r.cycles.forEach((group, i) => {
      const row = el('div', 'deps-cycle')
      row.dataset['cycle'] = String(i)
      row.append(el('div', 'deps-cycle-head', `${group.length} files import each other`))
      for (const n of group.slice(0, 6)) row.append(el('div', 'deps-cycle-file', r.graph.files[n] as string))
      if (group.length > 6) row.append(el('div', 'deps-cycle-file', `… and ${group.length - 6} more`))
      row.onclick = () => {
        mode = 'files'
        filter.value = ''
        const first = r.graph.files[group[0] as number] as string
        draw()
        selected = nodes.findIndex((n) => n.id === first)
        draw()
      }
      side.append(row)
    })
  }

  async function refresh(): Promise<void> {
    const root = d.getRoot()
    if (!root) {
      result = null
      return hint('Open a project to see its dependencies.')
    }
    hint('Reading the project…')
    try {
      result = await window.forge.depsAnalyse(root)
    } catch (err) {
      result = null
      return hint(err instanceof Error ? err.message : String(err), true)
    }
    selected = null
    draw()
  }

  refreshBtn.onclick = () => void refresh()
  depth.onchange = () => draw()
  filter.oninput = () => draw()

  return { refresh }
}
