import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { DARCULA, defineDarcula } from './darcula'
import { fuzzy } from './search'

self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

interface OpenFile {
  path: string
  model: monaco.editor.ITextModel
  savedVersion: number
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

const treeEl = $('tree')
const tabsEl = $('tabs')
const welcomeEl = $('welcome')
const statusEl = $('status')
const statusMsg = $('status-msg')
const statusPos = $('status-pos')

defineDarcula()
const editor = monaco.editor.create($('editor'), {
  theme: DARCULA,
  automaticLayout: true,
  fontFamily: 'JetBrains Mono, Consolas, monospace',
  fontSize: 13,
  minimap: { enabled: false },
  model: null
})

const openFiles = new Map<string, OpenFile>()
let active: OpenFile | null = null

const logEl = $('log')
let rootDir: string | null = null

function report(msg: string, isError = false): void {
  statusMsg.textContent = msg
  statusEl.classList.toggle('error', isError)
  if (isError) console.error(msg)
  const line = document.createElement('div')
  if (isError) line.className = 'err'
  const ts = document.createElement('span')
  ts.className = 'ts'
  ts.textContent = new Date().toLocaleTimeString()
  line.append(ts, msg)
  logEl.append(line)
  logEl.scrollTop = logEl.scrollHeight
}

// ---- Tool windows ----
const toolWindows: Record<string, HTMLElement> = { project: $('project'), output: $('output') }
// Each tool window's splitter is hidden together with it.
const splitters: Record<string, HTMLElement> = { project: $('split-project'), output: $('split-output') }

function toggleToolWindow(name: string): void {
  const win = toolWindows[name]
  const split = splitters[name]
  if (!win || !split) throw new Error(`Unknown tool window: ${name}`)
  win.hidden = !win.hidden
  split.hidden = win.hidden
  document.querySelector(`.tw-btn[data-tw="${name}"]`)?.classList.toggle('active', !win.hidden)
}

document.querySelectorAll<HTMLButtonElement>('.tw-btn').forEach((b) => {
  b.onclick = () => toggleToolWindow(b.dataset['tw'] ?? '')
})

function makeSplitter(split: HTMLElement, target: HTMLElement, axis: 'x' | 'y'): void {
  split.onmousedown = (down) => {
    down.preventDefault()
    const start = axis === 'x' ? down.clientX : down.clientY
    const startSize = axis === 'x' ? target.offsetWidth : target.offsetHeight
    const move = (e: MouseEvent): void => {
      // Project grows rightwards; Output grows upwards.
      const delta = axis === 'x' ? e.clientX - start : start - e.clientY
      const size = Math.max(80, startSize + delta)
      target.style[axis === 'x' ? 'width' : 'height'] = `${size}px`
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
}
makeSplitter($('split-project'), $('project'), 'x')
makeSplitter($('split-output'), $('output'), 'y')

// ---- Search Everywhere ----
const searchEl = $('search')
const searchInput = $<HTMLInputElement>('search-input')
const searchResults = $('search-results')
let fileIndex: string[] = []
let hits: { path: string; idx: number[] }[] = []
let selected = 0

function relPath(p: string): string {
  return rootDir && p.startsWith(rootDir) ? p.slice(rootDir.length + 1) : p
}

function renderResults(): void {
  searchResults.replaceChildren()
  if (!fileIndex.length) {
    const h = document.createElement('div')
    h.className = 'hint'
    h.textContent = 'Open a folder first (Ctrl+O)'
    searchResults.append(h)
    return
  }
  hits.forEach((h, i) => {
    const rel = relPath(h.path)
    const name = basename(rel)
    const nameStart = rel.length - name.length
    const row = document.createElement('div')
    row.className = 'result' + (i === selected ? ' sel' : '')
    const left = document.createElement('span')
    for (let c = 0; c < name.length; c++) {
      const ch = name[c] ?? ''
      if (h.idx.includes(nameStart + c)) {
        const m = document.createElement('mark')
        m.textContent = ch
        left.append(m)
      } else left.append(ch)
    }
    const dir = document.createElement('span')
    dir.className = 'dir'
    dir.textContent = rel.slice(0, Math.max(0, nameStart - 1))
    row.append(left, dir)
    row.onclick = () => chooseResult(i)
    searchResults.append(row)
  })
  searchResults.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
}

function runSearch(): void {
  const q = searchInput.value.trim()
  const scored: { path: string; idx: number[]; score: number }[] = []
  for (const p of fileIndex) {
    const rel = relPath(p)
    if (!q) {
      scored.push({ path: p, idx: [], score: 0 })
      continue
    }
    const m = fuzzy(q, rel)
    if (!m) continue
    // Prefer matches that land in the file name over matches in the directory path.
    const nameStart = rel.length - basename(rel).length
    const inName = m.idx.filter((i) => i >= nameStart).length
    scored.push({ path: p, idx: m.idx, score: m.score + inName * 6 })
  }
  scored.sort((a, b) => b.score - a.score)
  hits = scored.slice(0, 50)
  selected = 0
  renderResults()
}

async function openSearch(): Promise<void> {
  searchEl.hidden = false
  searchInput.value = ''
  searchInput.focus()
  fileIndex = []
  hits = []
  renderResults()
  if (!rootDir) return
  const root = rootDir
  await guarded('Index project', async () => {
    fileIndex = await window.forge.listFiles(root)
    // The user may have closed the box or opened another folder while indexing.
    if (!searchEl.hidden && rootDir === root) runSearch()
  })
}

function closeSearch(): void {
  searchEl.hidden = true
  if (active) editor.focus()
}

function chooseResult(i: number): void {
  const hit = hits[i]
  if (!hit) return
  closeSearch()
  void openFile(hit.path)
}

searchInput.oninput = runSearch
searchInput.onkeydown = (e) => {
  if (e.key === 'Escape') closeSearch()
  else if (e.key === 'Enter') chooseResult(selected)
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!hits.length) return
    selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length
    renderResults()
  }
}
searchEl.onmousedown = (e) => {
  if (e.target === searchEl) closeSearch()
}

// Double-tap Shift (no other key in between, within 400ms).
let lastShift = 0
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Shift') {
    lastShift = 0
    return
  }
  if (e.repeat) return
  const now = performance.now()
  if (now - lastShift < 400) {
    lastShift = 0
    void openSearch()
  } else lastShift = now
})

async function guarded<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    report(`${label}: ${err instanceof Error ? err.message : String(err)}`, true)
    throw err
  }
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p
const isDirty = (f: OpenFile): boolean => f.model.getAlternativeVersionId() !== f.savedVersion

function renderTabs(): void {
  tabsEl.replaceChildren()
  for (const f of openFiles.values()) {
    const tab = document.createElement('div')
    tab.className = 'tab' + (f === active ? ' active' : '')
    tab.textContent = basename(f.path) + (isDirty(f) ? ' •' : '')
    const close = document.createElement('span')
    close.className = 'close'
    close.textContent = '×'
    close.onclick = (e) => {
      e.stopPropagation()
      closeFile(f)
    }
    tab.append(close)
    tab.onclick = () => activate(f)
    tabsEl.append(tab)
  }
  welcomeEl.style.display = openFiles.size ? 'none' : 'flex'
}

function activate(f: OpenFile | null): void {
  active = f
  editor.setModel(f?.model ?? null)
  renderTabs()
  if (f) editor.focus()
}

function closeFile(f: OpenFile): void {
  openFiles.delete(f.path)
  f.model.dispose()
  if (active === f) activate([...openFiles.values()].pop() ?? null)
  else renderTabs()
}

async function openFile(path: string): Promise<void> {
  const existing = openFiles.get(path)
  if (existing) return activate(existing)
  await guarded(`Open ${basename(path)}`, async () => {
    const text = await window.forge.readFile(path)
    const model = monaco.editor.createModel(text, undefined, monaco.Uri.file(path))
    const f: OpenFile = { path, model, savedVersion: model.getAlternativeVersionId() }
    model.onDidChangeContent(() => renderTabs())
    openFiles.set(path, f)
    activate(f)
  })
}

async function saveActive(): Promise<void> {
  const f = active
  if (!f) return
  await guarded(`Save ${basename(f.path)}`, async () => {
    await window.forge.writeFile(f.path, f.model.getValue())
    f.savedVersion = f.model.getAlternativeVersionId()
    renderTabs()
    report(`Saved ${basename(f.path)}`)
  })
}

async function renderDir(dir: string, into: HTMLElement): Promise<void> {
  const entries = await window.forge.readDir(dir)
  for (const e of entries) {
    const row = document.createElement('div')
    row.className = 'node'
    row.innerHTML = `<span class="icon">${e.isDir ? '▸' : ''}</span>`
    row.append(e.name)
    into.append(row)
    if (e.isDir) {
      const kids = document.createElement('div')
      kids.className = 'children'
      kids.hidden = true
      let loaded = false
      into.append(kids)
      row.onclick = () =>
        void guarded(`Read ${e.name}`, async () => {
          kids.hidden = !kids.hidden
          row.querySelector('.icon')!.textContent = kids.hidden ? '▸' : '▾'
          if (!loaded) {
            loaded = true
            await renderDir(e.path, kids)
          }
        })
    } else {
      row.onclick = () => {
        treeEl.querySelectorAll('.node.active').forEach((n) => n.classList.remove('active'))
        row.classList.add('active')
        void openFile(e.path)
      }
    }
  }
}

async function openFolder(): Promise<void> {
  const dir = await window.forge.openFolder()
  if (!dir) return
  await guarded('Open folder', async () => {
    treeEl.replaceChildren()
    rootDir = dir
    await renderDir(dir, treeEl)
    document.title = `${basename(dir)} – Forge`
  })
}

editor.onDidChangeCursorPosition((e) => {
  statusPos.textContent = `${e.position.lineNumber}:${e.position.column}`
})

window.addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === '1' || e.key === '2')) {
    e.preventDefault()
    toggleToolWindow(e.key === '1' ? 'project' : 'output')
    return
  }
  if (!e.ctrlKey) return
  if (e.key === 'o') { e.preventDefault(); void openFolder() }
  else if (e.key === 's') { e.preventDefault(); void saveActive() }
  else if (e.key === 'w' && active) { e.preventDefault(); closeFile(active) }
})

renderTabs()
