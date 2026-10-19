import * as monaco from 'monaco-editor'
import type { DbCell, DbQueryResult, DbResult, DbSchema, DbTable } from '../main/database'
import { bindExtraEditor, editorOptions } from './appearance'

// The Database window: a SQLite file opened from the project tree. A schema tree on the left (click a table to preview
// it), a SQL editor on top (Ctrl+Enter runs the selection, or everything), and the result as a grid. It is read-only:
// SQLite itself refuses writes, and the file on disk is never touched.

export interface DatabaseDeps {
  /** The window's own root element. */
  root: HTMLElement
  /** Brings the window on screen. */
  reveal: () => void
  copy: (text: string) => void
  report: (msg: string, isError?: boolean) => void
}

export interface DatabaseView {
  /** Opens a SQLite file and shows its schema. */
  open: (path: string) => Promise<void>
  /** The file shown, or null. */
  current: () => string | null
}

const LIMITS = [100, 1000, 5000, 20000]
const DEFAULT_LIMIT = 1000

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`
const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
/** Errors that crossed the IPC boundary come wrapped ("Error invoking remote method …: Error: …"). */
const cleanError = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** RFC 4180: a field with a comma, quote or line break is quoted, and quotes inside it are doubled. */
export function toCsv(result: DbResult): string {
  const field = (c: DbCell): string => {
    const s = c === null ? '' : typeof c === 'object' ? `<${c.blob} bytes>` : String(c)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [result.columns.map((c) => field(c)).join(','), ...result.rows.map((r) => r.map(field).join(','))].join('\r\n')
}

export function initDatabase(d: DatabaseDeps): DatabaseView {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  // ---- layout ----
  const bar = el('div', 'tool-bar db-bar')
  const title = el('span', 'tool-title', 'Database')
  title.id = 'db-title'
  const limitSel = el('select', 'field db-limit')
  limitSel.id = 'db-limit'
  limitSel.title = 'The most rows a result shows'
  for (const n of LIMITS) {
    const o = el('option', '', `${n.toLocaleString()} rows`)
    o.value = String(n)
    limitSel.append(o)
  }
  limitSel.value = String(DEFAULT_LIMIT)
  const run = el('button', 'btn-primary', 'Run')
  run.id = 'db-run'
  run.title = 'Run the selection, or everything (Ctrl+Enter)'
  const stop = el('button', 'btn', 'Stop')
  stop.id = 'db-stop'
  stop.hidden = true
  const csv = el('button', 'btn', 'Copy as CSV')
  csv.id = 'db-csv'
  csv.disabled = true
  const status = el('span', 'db-status')
  status.id = 'db-status'
  bar.append(title, status, limitSel, csv, run, stop)

  const body = el('div', 'db-body')
  const schemaPane = el('div', 'db-schema')
  schemaPane.id = 'db-schema'
  const main = el('div', 'db-main')
  const editorHost = el('div', 'db-editor')
  editorHost.id = 'db-editor'
  const resultTabs = el('div', 'db-tabs')
  resultTabs.id = 'db-tabs'
  const grid = el('div', 'db-grid')
  grid.id = 'db-grid'
  main.append(editorHost, resultTabs, grid)
  body.append(schemaPane, main)
  d.root.replaceChildren(bar, body)

  const sqlEditor = monaco.editor.create(editorHost, {
    ...editorOptions(),
    value: '',
    language: 'sql',
    minimap: { enabled: false },
    lineNumbers: 'off',
    folding: false,
    glyphMargin: false,
    lineDecorationsWidth: 6,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    stickyScroll: { enabled: false },
    inlayHints: { enabled: 'off' },
    renderLineHighlight: 'none',
    wordWrap: 'on'
  })
  // Follows the font and theme settings, but keeps its own compact layout whatever the settings say.
  bindExtraEditor(sqlEditor, {
    minimap: { enabled: false },
    lineNumbers: 'off',
    folding: false,
    glyphMargin: false,
    stickyScroll: { enabled: false },
    inlayHints: { enabled: 'off' },
    renderLineHighlight: 'none',
    wordWrap: 'on'
  })

  // ---- state ----
  let path: string | null = null
  let schema: DbSchema | null = null
  let running = false
  let results: DbResult[] = []
  let shown = 0
  let sort: { col: number; dir: 1 | -1 } | null = null
  const queries = new Map<string, string>() // what was typed, per file, for the session
  const opened = new Set<string>() // columns shown for a table

  const limit = (): number => Number(limitSel.value)
  const setStatus = (text: string, error = false): void => {
    status.textContent = text
    status.classList.toggle('err', error)
  }

  // ---- the schema tree ----
  function drawSchema(): void {
    schemaPane.replaceChildren()
    if (!schema) {
      schemaPane.append(el('div', 'hint', 'Open a .db, .sqlite or .sqlite3 file from the project tree.'))
      return
    }
    const head = el('div', 'db-version', `SQLite ${schema.sqliteVersion} · ${schema.tables.length} table${schema.tables.length === 1 ? '' : 's'} and views`)
    schemaPane.append(head)
    for (const t of schema.tables) {
      const row = el('div', `db-table kind-${t.kind}`)
      row.dataset['table'] = t.name
      const chev = el('span', 'db-chev', opened.has(t.name) ? '▾' : '▸')
      chev.onclick = (ev) => {
        ev.stopPropagation()
        if (opened.has(t.name)) opened.delete(t.name)
        else opened.add(t.name)
        drawSchema()
      }
      const name = el('span', 'db-tname', t.name)
      const meta = el('span', 'db-count', t.rows === null ? 'view' : t.rows.toLocaleString())
      row.append(chev, name, meta)
      row.title = `Preview ${t.name}`
      row.onclick = () => preview(t)
      schemaPane.append(row)
      if (opened.has(t.name)) {
        for (const c of t.columns) {
          const col = el('div', 'db-col')
          col.append(el('span', 'db-cname', c.name), el('span', 'db-ctype', c.type || '—'))
          if (c.pk) col.append(el('span', 'db-badge', 'PK'))
          if (c.notNull) col.append(el('span', 'db-badge dim', 'NN'))
          schemaPane.append(col)
        }
      }
    }
  }

  // ---- the result grid ----
  function cellNode(c: DbCell): HTMLElement {
    const td = el('td')
    if (c === null) td.append(el('span', 'db-null', 'NULL'))
    else if (typeof c === 'object') td.append(el('span', 'db-blob', `‹BLOB ${c.blob.toLocaleString()} B›`))
    else {
      td.textContent = String(c)
      if (typeof c === 'number') td.className = 'num'
      if (String(c).length > 40) td.title = String(c).slice(0, 600)
    }
    return td
  }

  function drawGrid(): void {
    grid.replaceChildren()
    const r = results[shown]
    csv.disabled = !r
    if (!r) return
    const rows = sort
      ? [...r.rows].sort((a, b) => {
          const x = a[sort!.col] ?? null
          const y = b[sort!.col] ?? null
          if (x === y) return 0
          if (x === null) return -1 * sort!.dir
          if (y === null) return 1 * sort!.dir
          if (typeof x === 'object' || typeof y === 'object') return 0
          return (x < y ? -1 : 1) * sort!.dir
        })
      : r.rows
    const table = el('table')
    const thead = el('thead')
    const hr = el('tr')
    hr.append(el('th', 'rownum', '#'))
    r.columns.forEach((name, i) => {
      const th = el('th', sort?.col === i ? 'sorted' : '', name + (sort?.col === i ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''))
      th.title = 'Click to sort the rows shown'
      th.onclick = () => {
        sort = sort?.col === i ? (sort.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 }
        drawGrid()
      }
      hr.append(th)
    })
    thead.append(hr)
    const tbody = el('tbody')
    rows.forEach((row, i) => {
      const tr = el('tr')
      tr.append(el('td', 'rownum', String(i + 1)))
      for (const c of row) tr.append(cellNode(c))
      tbody.append(tr)
    })
    table.append(thead, tbody)
    grid.append(table)
    if (!rows.length) grid.append(el('div', 'hint', 'No rows'))
    if (r.truncated) grid.append(el('div', 'db-trunc', `Only the first ${r.rows.length.toLocaleString()} rows are shown. Add a WHERE or LIMIT, or raise the row limit above.`))
  }

  function drawTabs(): void {
    resultTabs.replaceChildren()
    resultTabs.hidden = results.length < 2
    results.forEach((r, i) => {
      const b = el('button', `db-tab${i === shown ? ' active' : ''}`, `Result ${i + 1} (${r.rows.length}${r.truncated ? '+' : ''})`)
      b.onclick = () => {
        shown = i
        sort = null
        drawTabs()
        drawGrid()
      }
      resultTabs.append(b)
    })
  }

  // ---- running SQL ----
  async function execute(sql: string): Promise<void> {
    if (!path || running) return
    const file = path
    running = true
    run.hidden = true
    stop.hidden = false
    setStatus('Running…')
    try {
      const res: DbQueryResult = await window.forge.dbQuery(file, sql, limit())
      if (path !== file) return // another database was opened meanwhile
      results = res.results
      shown = 0
      sort = null
      const total = results.reduce((n, r) => n + r.rows.length, 0)
      setStatus(results.length ? `${total.toLocaleString()} row${total === 1 ? '' : 's'} in ${res.ms} ms` : `Done in ${res.ms} ms (no rows returned)`)
    } catch (err) {
      results = []
      setStatus(cleanError(err), true)
    } finally {
      running = false
      run.hidden = false
      stop.hidden = true
      drawTabs()
      drawGrid()
    }
  }

  function runEditor(): void {
    const sel = sqlEditor.getSelection()
    const model = sqlEditor.getModel()
    const text = model && sel && !sel.isEmpty() ? model.getValueInRange(sel) : sqlEditor.getValue()
    queries.set(path ?? '', sqlEditor.getValue())
    void execute(text)
  }

  function preview(t: DbTable): void {
    sqlEditor.setValue(`SELECT * FROM ${quote(t.name)};`)
    queries.set(path ?? '', sqlEditor.getValue())
    void execute(`SELECT * FROM ${quote(t.name)}`)
  }

  run.onclick = runEditor
  stop.onclick = () => {
    if (path) void window.forge.dbStop(path)
  }
  csv.onclick = () => {
    const r = results[shown]
    if (!r) return
    d.copy(toCsv(r))
    d.report(`Copied ${r.rows.length.toLocaleString()} row${r.rows.length === 1 ? '' : 's'} as CSV`)
  }
  // Ctrl+Enter is handled on the editor's own element, not with addCommand: Monaco keeps commands in a registry shared by
  // all editors, where the HTTP client's Ctrl+Enter would win over this one.
  editorHost.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        runEditor()
      }
    },
    true
  )
  sqlEditor.onDidChangeModelContent(() => {
    if (path) queries.set(path, sqlEditor.getValue())
  })

  drawSchema()
  drawGrid()
  drawTabs()

  return {
    async open(file) {
      d.reveal()
      const previous = path
      setStatus('Opening…')
      try {
        const s = await window.forge.dbOpen(file)
        if (previous && previous !== file) void window.forge.dbClose(previous).catch(() => undefined)
        path = file
        schema = s
        opened.clear()
        results = []
        shown = 0
        sort = null
        title.textContent = baseName(file)
        sqlEditor.setValue(queries.get(file) ?? (s.tables[0] ? `SELECT * FROM ${quote(s.tables[0].name)};` : ''))
        setStatus(`${s.tables.length} table${s.tables.length === 1 ? '' : 's'} and views`)
        drawSchema()
        drawTabs()
        drawGrid()
      } catch (err) {
        setStatus(cleanError(err), true)
        throw new Error(`Open database: ${cleanError(err)}`)
      }
    },
    current: () => path
  }
}
