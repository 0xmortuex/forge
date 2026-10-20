import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { detectDelimiter, filterRows, parseDelimited, sortRows } from './csv'
import { formatBytes, HEX_WIDTH, hexRows } from './hex'
import { parseNotebook } from './notebook'

// The Viewer window: the file in the editor as a table (CSV / TSV), as a rendered notebook (.ipynb) or as a hex dump (any
// file, read from disk). It follows the active tab; the table and the notebook show unsaved edits too.

export type ViewerMode = 'table' | 'notebook' | 'hex'

export interface ViewerDeps {
  root: HTMLElement
  /** The file in the editor: its path and, for a text file, its current text (null for an image). */
  current: () => { path: string; text: string | null } | null
  isVisible: () => boolean
  report: (msg: string, isError?: boolean) => void
}

export interface Viewer {
  refresh: () => Promise<void>
}

const MAX_TABLE_ROWS = 2000
const HEX_PAGE = 4096

const nameOf = (p: string): string => p.replace(/^.*[\\/]/, '')

/** The mode that suits a file best. */
export function defaultMode(path: string): ViewerMode {
  if (/\.(csv|tsv|psv)$/i.test(path)) return 'table'
  if (/\.ipynb$/i.test(path)) return 'notebook'
  return 'hex'
}

function modesFor(hasText: boolean): ViewerMode[] {
  const modes: ViewerMode[] = []
  if (hasText) modes.push('table', 'notebook')
  modes.push('hex')
  return modes
}

const MODE_LABEL: Record<ViewerMode, string> = { table: 'Table', notebook: 'Notebook', hex: 'Hex' }

export function initViewer(d: ViewerDeps): Viewer {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  const bar = el('div', 'tool-bar viewer-bar')
  const title = el('span', 'tool-title', 'Viewer')
  title.id = 'viewer-title'
  const modeBox = el('span', 'viewer-modes')
  modeBox.id = 'viewer-modes'
  const filter = el('input', 'field viewer-filter')
  filter.id = 'viewer-filter'
  filter.placeholder = 'Filter rows'
  filter.spellcheck = false
  const header = el('label', 'viewer-header')
  const headerBox = el('input')
  headerBox.type = 'checkbox'
  headerBox.checked = true
  headerBox.id = 'viewer-header'
  header.append(headerBox, document.createTextNode(' First row is the header'))
  const info = el('span', 'viewer-info')
  info.id = 'viewer-info'
  bar.append(title, modeBox, header, filter, info)
  const body = el('div', 'viewer-body')
  body.id = 'viewer-body'
  d.root.replaceChildren(bar, body)

  const chosen = new Map<string, ViewerMode>() // the user's pick per file, for this session
  let seq = 0
  let sort: { column: number; descending: boolean } | null = null
  let sortedFor = ''
  let hexOffset = 0
  let hexPath = ''

  const message = (text: string, error = false): void => {
    body.replaceChildren(el('div', error ? 'hint err' : 'hint', text))
    info.textContent = ''
  }

  function renderTable(path: string, text: string): void {
    const parsed = parseDelimited(text, detectDelimiter(text, path))
    if (!parsed.length) return message('This file is empty.')
    const hasHeader = headerBox.checked
    const head = hasHeader ? (parsed[0] ?? []) : []
    const columns = Math.max(...parsed.map((r) => r.length))
    let rows = hasHeader ? parsed.slice(1) : parsed
    const total = rows.length
    rows = filterRows(rows, filter.value)
    if (sortedFor !== path) {
      sort = null
      sortedFor = path
    }
    if (sort) rows = sortRows(rows, sort.column, sort.descending)

    const table = el('table', 'viewer-table')
    const thead = el('thead')
    const hr = el('tr')
    hr.append(el('th', 'rownum', '#'))
    for (let c = 0; c < columns; c++) {
      const th = el('th', sort?.column === c ? 'sorted' : '', (head[c] ?? `Column ${c + 1}`) + (sort?.column === c ? (sort.descending ? ' ▼' : ' ▲') : ''))
      th.onclick = () => {
        sort = { column: c, descending: sort?.column === c ? !sort.descending : false }
        renderTable(path, text)
      }
      hr.append(th)
    }
    thead.append(hr)
    const tbody = el('tbody')
    rows.slice(0, MAX_TABLE_ROWS).forEach((r, i) => {
      const tr = el('tr')
      tr.append(el('td', 'rownum', String(i + 1)))
      for (let c = 0; c < columns; c++) {
        const v = r[c] ?? ''
        tr.append(el('td', /^-?\d+(\.\d+)?$/.test(v) ? 'num' : '', v))
      }
      tbody.append(tr)
    })
    table.append(thead, tbody)
    const wrap = el('div', 'viewer-scroll')
    wrap.append(table)
    if (rows.length > MAX_TABLE_ROWS) wrap.append(el('div', 'viewer-trunc', `Showing the first ${MAX_TABLE_ROWS.toLocaleString()} of ${rows.length.toLocaleString()} rows. Filter to narrow it down.`))
    body.replaceChildren(wrap)
    info.textContent = `${filter.value.trim() ? `${rows.length.toLocaleString()} of ` : ''}${total.toLocaleString()} rows × ${columns} columns`
  }

  function renderNotebook(text: string): void {
    const nb = parseNotebook(text)
    const wrap = el('div', 'viewer-scroll nb')
    for (const cell of nb.cells) {
      const box = el('div', `nb-cell nb-${cell.kind}`)
      if (cell.kind === 'markdown') {
        const md = el('div', 'md-body')
        md.innerHTML = DOMPurify.sanitize(marked.parse(cell.source, { gfm: true, async: false }) as string)
        box.append(md)
      } else {
        const code = el('div', 'nb-source')
        code.append(el('span', 'nb-prompt', cell.kind === 'code' ? `In [${cell.count ?? ' '}]:` : 'Raw'), el('pre', '', cell.source))
        box.append(code)
        for (const out of cell.outputs) {
          const o = el('div', 'nb-output')
          if (out.kind === 'text') o.append(el('pre', out.error ? 'nb-error' : '', out.text))
          else if (out.kind === 'image') {
            const img = el('img')
            img.src = out.url
            o.append(img)
          } else o.innerHTML = DOMPurify.sanitize(out.html)
          box.append(o)
        }
      }
      wrap.append(box)
    }
    body.replaceChildren(wrap)
    info.textContent = `${nb.cells.length} cells · ${nb.language}`
  }

  async function renderHex(path: string): Promise<void> {
    if (hexPath !== path) {
      hexPath = path
      hexOffset = 0
    }
    const { data, size } = await window.forge.readBytes(path, hexOffset, HEX_PAGE)
    const pre = el('pre', 'viewer-hex')
    pre.id = 'viewer-hex'
    pre.textContent = hexRows(data, hexOffset)
      .map((r) => `${r.offset}  ${r.bytes.slice(0, HEX_WIDTH / 2).join(' ').padEnd((HEX_WIDTH / 2) * 3 - 1)}  ${r.bytes.slice(HEX_WIDTH / 2).join(' ').padEnd((HEX_WIDTH / 2) * 3 - 1)}  |${r.ascii}|`)
      .join('\n')
    const nav = el('div', 'viewer-hexnav')
    const prev = el('button', 'btn small', '‹ Previous')
    prev.id = 'viewer-prev'
    prev.disabled = hexOffset === 0
    prev.onclick = () => {
      hexOffset = Math.max(0, hexOffset - HEX_PAGE)
      void refresh()
    }
    const next = el('button', 'btn small', 'Next ›')
    next.id = 'viewer-next'
    next.disabled = hexOffset + HEX_PAGE >= size
    next.onclick = () => {
      hexOffset += HEX_PAGE
      void refresh()
    }
    const go = el('input', 'field viewer-goto')
    go.id = 'viewer-goto'
    go.placeholder = 'Go to offset (hex)'
    go.spellcheck = false
    go.onkeydown = (e) => {
      if (e.key !== 'Enter') return
      const n = parseInt(go.value.replace(/^0x/i, ''), 16)
      if (Number.isNaN(n) || n < 0 || n >= Math.max(size, 1)) return d.report(`Offset out of range: ${go.value} (the file has ${size} bytes)`, true)
      hexOffset = n - (n % HEX_PAGE)
      void refresh()
    }
    nav.append(prev, next, go)
    const wrap = el('div', 'viewer-scroll')
    wrap.append(pre)
    body.replaceChildren(nav, wrap)
    info.textContent = `${formatBytes(size)} · offset ${hexOffset.toString(16).padStart(8, '0')}`
  }

  async function refresh(): Promise<void> {
    if (!d.isVisible()) return
    const mine = ++seq
    const cur = d.current()
    if (!cur) {
      title.textContent = 'Viewer'
      modeBox.replaceChildren()
      return message('Open a file to view it as a table (CSV / TSV), a notebook (.ipynb) or a hex dump.')
    }
    title.textContent = nameOf(cur.path)
    const modes = modesFor(cur.text !== null)
    let mode = chosen.get(cur.path) ?? defaultMode(cur.path)
    if (!modes.includes(mode)) mode = 'hex'
    modeBox.replaceChildren(
      ...modes.map((m) => {
        const b = el('button', `viewer-mode${m === mode ? ' active' : ''}`, MODE_LABEL[m])
        b.dataset['mode'] = m
        b.onclick = () => {
          chosen.set(cur.path, m)
          void refresh()
        }
        return b
      })
    )
    header.hidden = filter.hidden = mode !== 'table'
    try {
      if (mode === 'table' && cur.text !== null) renderTable(cur.path, cur.text)
      else if (mode === 'notebook' && cur.text !== null) renderNotebook(cur.text)
      else await renderHex(cur.path)
    } catch (err) {
      if (mine === seq) message(err instanceof Error ? err.message : String(err), true)
    }
  }

  filter.oninput = () => void refresh()
  headerBox.onchange = () => void refresh()

  return { refresh }
}
