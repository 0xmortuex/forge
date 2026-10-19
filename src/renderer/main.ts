import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/fira-code/400.css'
import '@fontsource/fira-code/700.css'
import '@fontsource-variable/inter/index.css'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { initAppearance, bindEditors, editorOptions, setCustomCss } from './appearance'
import { ensureSettingsFile, flushSettings, settings, userData } from './settings'
import { initRipples, shouldToast, toast } from './effects'
import { initPalette } from './commands'
import { initSettingsUi } from './settings-ui'
import { session } from './session'
import { keymap } from './keymap'
import { extensions, initExtensions } from './extensions'
import { registerBuiltinCommands } from './builtin-commands'
import { fuzzy } from './search'
import { fileColor, fileIcon, folderIcon, icons } from './icons'
import { askText, showMenu, type MenuItem } from './menu'
import { initFind } from './find'
import { createTerminalView } from './terminal'
import { initTerminals } from './terminals'
import { initLsp } from './lsp'
import { initGit } from './git'
import { registerMort } from './mort'
import { initDebug } from './debug'
import { initRun } from './run'
import { createToolWindows, type DockName } from './docks'
import { initStructure } from './structure'
import { initProblems } from './problems'
import { initBreadcrumbs } from './breadcrumbs'
import { initTooltips } from './tooltips'
import { initQuick } from './quick'
import { initNavigation } from './navigation'
import { initBookmarks } from './bookmarks'
import type { ChangeKind, GitChange } from '../main/git'

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
  model: monaco.editor.ITextModel // for a diff tab: the working-copy side (shared with the file tab when editable)
  savedVersion: number
  // Present on diff tabs: the HEAD side, and the file tab whose model the right side edits (none for deleted files).
  diff?: { original: monaco.editor.ITextModel; shared?: OpenFile }
}

/** Map key: a file and its diff are separate tabs for the same path. */
const tabKey = (f: { path: string; diff?: unknown }): string => (f.diff ? `diff:${f.path}` : f.path)

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
const stPos = $('st-pos')
const stEol = $('st-eol')
const stIndent = $('st-indent')
const stLang = $('st-lang')

registerMort()
const themeName = initAppearance() // theme, fonts, layout, motion: everything the user chose
requestAnimationFrame(() => document.documentElement.classList.add('ready')) // the page fades in, already themed
// Monaco's in-browser TS worker can't resolve node_modules, so its results are wrong or duplicated.
// All TS/JS intelligence comes from the language server (see lsp.ts); only highlighting stays built in.
for (const defaults of [
  monaco.languages.typescript.typescriptDefaults,
  monaco.languages.typescript.javascriptDefaults
]) {
  defaults.setModeConfiguration({
    completionItems: false, hovers: false, documentSymbols: false, definitions: false, references: false,
    documentHighlights: false, rename: false, diagnostics: false, documentRangeFormattingEdits: false,
    signatureHelp: false, onTypeFormattingEdits: false, codeActions: false, inlayHints: false
  })
}
const editor = monaco.editor.create($('editor'), {
  ...editorOptions(), // fonts, minimap, cursor... all from settings
  theme: themeName,
  automaticLayout: true,
  glyphMargin: true,
  padding: { top: 6 },
  renderLineHighlight: 'all',
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  model: null
})

const diffEditor = monaco.editor.createDiffEditor($('diff'), {
  automaticLayout: true,
  originalEditable: false, // the HEAD side never edits; the working-copy side is made editable per tab
  scrollBeyondLastLine: false,
  renderSideBySide: true
})
bindEditors(editor, diffEditor) // from here on, editor settings apply live to both
// The bundled coding fonts load asynchronously; once they have, tell Monaco to re-measure its characters.
void Promise.all([document.fonts.load('13px "JetBrains Mono"'), document.fonts.load('13px "Fira Code"')])
  .then(() => monaco.editor.remeasureFonts())
  .catch((err: unknown) => console.error('Loading the bundled fonts failed', err))

// Static icons for buttons declared in index.html.
const setIcon = (sel: string, html: string): void => {
  document.querySelectorAll(sel).forEach((el) => (el.innerHTML = html))
}
setIcon('#debug-btn', icons.bug)
setIcon('#search-ico', icons.search)
setIcon('#palette-btn', icons.command)
setIcon('#settings-btn', icons.gear)
initRipples()
initTooltips()
setIcon('#project-chev', icons.chevronDown)
setIcon('[data-hide]', icons.minus)

const openFiles = new Map<string, OpenFile>()
let active: OpenFile | null = null

const logEl = $('log')
let rootDir: string | null = null

/** Restarts a CSS entrance animation on an element (tool windows, views). */
function playEnter(el: HTMLElement): void {
  el.classList.remove('enter')
  void el.offsetWidth // forces a reflow so the animation starts over
  el.classList.add('enter')
  el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true })
}

function report(msg: string, isError = false): void {
  statusMsg.textContent = msg
  statusMsg.classList.remove('flash')
  void statusMsg.offsetWidth
  if (!isError) statusMsg.classList.add('flash')
  const kind = shouldToast(msg, isError)
  if (kind) toast(msg, kind)
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
// Each one lives in the left, right or bottom dock (see docks.ts) and can be moved between them. Project and Commit
// start on the left; Output, Terminal, Find, Run, Debug and Problems at the bottom; Structure on the right.
const tw = createToolWindows({
  enter: playEnter,
  changed: () => saveSession(),
  els: {
    left: { panel: $('project'), splitter: $('split-project'), tabs: $('side-tabs') },
    right: { panel: $('right'), splitter: $('split-right'), tabs: $('right-tabs') },
    bottom: { panel: $('bottom'), splitter: $('split-bottom'), tabs: $('bottom-tabs') },
    stripeLeftTop: $('stripe-left-top'),
    stripeLeftBottom: $('stripe-left-bottom'),
    stripeLeft: $('stripe'),
    stripeRight: $('stripe-right')
  }
})
tw.register({ id: 'project', title: 'Project', icon: icons.project, root: $('project-view'), dock: 'left', shortcut: 'Alt+1' })
tw.register({ id: 'commit', title: 'Commit', icon: icons.commit, root: $('commit-view'), dock: 'left', shortcut: 'Alt+0' })
tw.register({ id: 'output', title: 'Output', icon: icons.output, root: $('view-output'), dock: 'bottom', shortcut: 'Alt+2' })
tw.register({ id: 'terminal', title: 'Terminal', icon: icons.terminal, root: $('view-terminal'), dock: 'bottom', shortcut: 'Alt+3', passive: false })
tw.register({ id: 'find', title: 'Find', icon: icons.search, root: $('view-find'), dock: 'bottom', shortcut: 'Ctrl+Shift+F' })
tw.register({ id: 'run', title: 'Run', icon: icons.play, root: $('view-run'), dock: 'bottom', shortcut: 'Shift+F10', passive: false })
tw.register({ id: 'debug', title: 'Debug', icon: icons.bug, root: $('view-debug'), dock: 'bottom', passive: false })
tw.register({ id: 'problems', title: 'Problems', icon: icons.problems, root: $('view-problems'), dock: 'bottom', shortcut: 'Alt+6' })
tw.register({ id: 'structure', title: 'Structure', icon: icons.structure, root: $('view-structure'), dock: 'right', shortcut: 'Alt+7' })
tw.register({ id: 'bookmarks', title: 'Bookmarks', icon: icons.bookmark, root: $('view-bookmarks'), dock: 'right' })

type View = 'output' | 'terminal' | 'find' | 'run' | 'debug' | 'problems' | 'structure' | 'bookmarks'
type Side = 'project' | 'commit'
const showSide = (side: Side): void => tw.show(side)
const toggleSide = (side: Side): void => tw.toggle(side)
const showView = (view: View): void => tw.show(view)
const toggleView = (view: View): void => tw.toggle(view)

// ---- Search Everywhere ----
const searchEl = $('search')
const searchInput = $<HTMLInputElement>('search-input')
const searchResults = $('search-results')
let fileIndex: string[] = []
let hits: { path: string; idx: number[] }[] = []
let selected = 0

function relPath(p: string): string {
  // Case-insensitive: language servers report a lowercase drive letter ("c:\...") where the root has "C:\...".
  return rootDir && p.toLowerCase().startsWith(rootDir.toLowerCase()) ? p.slice(rootDir.length + 1) : p
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
const isDirty = (f: OpenFile): boolean =>
  f.diff ? (f.diff.shared ? isDirty(f.diff.shared) : false) : f.model.getAlternativeVersionId() !== f.savedVersion

function tabMenu(f: OpenFile): (MenuItem | 'sep')[] {
  const closeAll = (keep?: OpenFile): void => {
    for (const other of [...openFiles.values()]) {
      if (other !== keep && !requestClose(other)) return // the user said no to discarding something: stop there
    }
  }
  return [
    { label: 'Close', run: () => void requestClose(f) },
    { label: 'Close Others', run: () => closeAll(f) },
    { label: 'Close All', run: () => closeAll() },
    'sep',
    { label: 'Copy Path', run: () => void window.forge.copyText(f.path) },
    { label: 'Reveal in File Explorer', run: () => void window.forge.reveal(f.path) }
  ]
}

/** Drops the tab `fromKey` where the tab `toKey` is. */
function moveTab(fromKey: string, toKey: string): void {
  if (fromKey === toKey) return
  const entries = [...openFiles.entries()]
  const from = entries.findIndex(([k]) => k === fromKey)
  const to = entries.findIndex(([k]) => k === toKey)
  if (from < 0 || to < 0) return
  const [moved] = entries.splice(from, 1)
  entries.splice(to, 0, moved!)
  openFiles.clear()
  for (const [k, v] of entries) openFiles.set(k, v)
  renderTabs()
}
// The mouse wheel scrolls a crowded tab bar sideways.
tabsEl.addEventListener('wheel', (e) => {
  if (!e.deltaY) return
  e.preventDefault()
  tabsEl.scrollLeft += e.deltaY
}, { passive: false })

const renderedTabs = new Set<string>() // tabs that already exist don't replay their entrance

function renderTabs(): void {
  tabsEl.replaceChildren()
  const keys = new Set<string>()
  for (const f of openFiles.values()) {
    const tab = document.createElement('div')
    keys.add(tabKey(f))
    tab.className = 'tab' + (f === active ? ' active' : '') + (renderedTabs.has(tabKey(f)) ? '' : ' enter')
    const name = basename(f.path)
    if (settings.get<boolean>('colorful')) {
      const color = fileColor(name)
      if (color) tab.style.setProperty('--tab-color', color)
    }
    tab.innerHTML = fileIcon(name)
    tab.append(f.diff ? `${name} (diff)` : name)
    if (isDirty(f)) {
      const dot = document.createElement('span')
      dot.className = 'dot'
      dot.textContent = '●'
      tab.append(dot)
    }
    const close = document.createElement('span')
    close.className = 'close'
    close.innerHTML = icons.close
    close.onclick = (e) => {
      e.stopPropagation()
      requestClose(f)
    }
    tab.append(close)
    tab.onclick = () => activate(f)
    tab.onauxclick = (e) => {
      if (e.button !== 1) return
      e.preventDefault()
      requestClose(f)
    }
    tab.draggable = true
    tab.ondragstart = (e) => e.dataTransfer?.setData('text/forge-tab', tabKey(f))
    tab.ondragover = (e) => {
      if (!e.dataTransfer?.types.includes('text/forge-tab')) return
      e.preventDefault()
      tab.classList.add('drop')
    }
    tab.ondragleave = () => tab.classList.remove('drop')
    tab.ondrop = (e) => {
      e.preventDefault()
      const from = e.dataTransfer?.getData('text/forge-tab')
      if (from) moveTab(from, tabKey(f))
    }
    tab.oncontextmenu = (ev) => {
      ev.preventDefault()
      showMenu(ev.clientX, ev.clientY, tabMenu(f))
    }
    tabsEl.append(tab)
  }
  tabsEl.querySelector('.tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  renderedTabs.clear()
  for (const k of keys) renderedTabs.add(k)
  saveSession()
  welcomeEl.style.display = openFiles.size ? 'none' : 'flex'
}

function activate(f: OpenFile | null): void {
  active = f
  $('editor').hidden = !!f?.diff
  $('diff').hidden = !f?.diff
  if (f?.diff) {
    diffEditor.setModel({ original: f.diff.original, modified: f.model })
    // Only a diff against a real file is editable; a deleted file has nothing to save into.
    diffEditor.getModifiedEditor().updateOptions({ readOnly: !f.diff.shared })
  } else {
    // Don't leave the hidden diff editor holding models that may be disposed later.
    diffEditor.setModel(null)
    editor.setModel(f?.model ?? null)
  }
  renderTabs()
  if (f) (f.diff ? diffEditor.getModifiedEditor() : editor).focus()
  updateStatus()
  breadcrumbs.refresh()
  if (f && !f.diff) nav.visit()
  if (f && !f.diff && settings.get<boolean>('treeFollow')) void locateInTree(f.path).catch((err: unknown) => report(`Locate in tree: ${String(err)}`, true))
}

/** User-initiated close: asks first if that would throw away unsaved edits. */
function requestClose(f: OpenFile): boolean {
  const unsaved = f.diff ? f.diff.shared : f
  if (unsaved && isDirty(unsaved) && !confirm(`${basename(unsaved.path)} has unsaved changes. Close it and discard them?`)) return false
  closeFile(f)
  return true
}

function closeFile(f: OpenFile): void {
  if (!openFiles.has(tabKey(f))) return // already closed, e.g. together with the file it shows
  // A diff that edits this file's model must go first, or it would be left holding a disposed model.
  if (!f.diff) for (const d of [...openFiles.values()]) if (d.diff?.shared === f) closeFile(d)
  openFiles.delete(tabKey(f))
  if (f.diff) {
    // Monaco requires the diff editor to let go of its models before they are disposed.
    if (active === f) diffEditor.setModel(null)
    f.diff.original.dispose()
    if (!f.diff.shared) f.model.dispose() // a shared model belongs to the file tab
  } else {
    lsp.closeDoc(f.model)
    bookmarks.onModelClosing(f.model)
    dbg.onModelClosing(f.model, f.path)
    f.model.dispose()
  }
  if (active === f) activate([...openFiles.values()].pop() ?? null)
  else renderTabs()
}

// Windows paths are case-insensitive, and servers/Monaco may hand back a different drive-letter case.
const samePath = (a: string, b: string): boolean => norm(a).toLowerCase() === norm(b).toLowerCase()

async function openFile(path: string, line?: number, column = 1): Promise<void> {
  const existing = [...openFiles.values()].find((f) => !f.diff && samePath(f.path, path))
  if (existing) activate(existing)
  else {
    await guarded(`Open ${basename(path)}`, async () => {
      const text = await window.forge.readFile(path)
      const model = monaco.editor.createModel(text, undefined, monaco.Uri.file(path))
      const f: OpenFile = { path, model, savedVersion: model.getAlternativeVersionId() }
      model.onDidChangeContent(() => renderTabs())
      openFiles.set(path, f)
      bookmarks.onModelOpened(model, path)
      lsp.openDoc(model, path) // before activate(): views that react to the new model (Structure) already find the document
      activate(f)
      extensions.emit('open', { path })
      dbg.onModelOpened(model, path)
    })
  }
  if (line) {
    editor.setPosition({ lineNumber: line, column })
    editor.revealLineInCenter(line)
  }
}

async function saveActive(opts: { format?: boolean } = {}): Promise<void> {
  // From a diff tab, Save writes the file the diff is editing.
  const f = active?.diff ? active.diff.shared : active
  if (!f) return
  await guarded(`Save ${basename(f.path)}`, async () => {
    // Format first when asked to (not for auto-save, which would move the text under the cursor), and only
    // when the editor is showing this file. A language without a formatter is skipped quietly.
    if (opts.format !== false && settings.get<boolean>('formatOnSave') && active && !active.diff) {
      await lsp.quietFormat(async () => {
        await editor.getAction('editor.action.formatDocument')?.run()
      })
    }
    await window.forge.writeFile(f.path, f.model.getValue())
    if (samePath(f.path, userData.customCssPath)) setCustomCss(f.model.getValue()) // saving custom.css restyles live
    f.savedVersion = f.model.getAlternativeVersionId()
    renderTabs()
    report(`Saved ${basename(f.path)}`)
    extensions.emit('save', { path: f.path })
  })
  refreshGit()
}

// ---- Project tree ----
// Every rendered directory, so one folder can be refreshed after a file operation.
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/$/, '')
const parentOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')
const dirs = new Map<string, { kids: HTMLElement; depth: number; setOpen?: (open: boolean) => Promise<void> }>()

async function renderDir(dir: string, into: HTMLElement, depth = 0): Promise<void> {
  const entries = await window.forge.readDir(dir)
  for (const e of entries) {
    const row = document.createElement('div')
    row.className = 'node'
    row.dataset['path'] = e.path
    row.style.paddingLeft = `${depth * 14 + 6}px`
    row.style.setProperty('--depth', String(depth))
    const twisty = document.createElement('span')
    twisty.className = 'twisty'
    if (e.isDir) twisty.innerHTML = icons.chevronRight
    row.append(twisty)
    row.insertAdjacentHTML('beforeend', e.isDir ? folderIcon(e.name) : fileIcon(e.name))
    row.append(e.name)
    into.append(row)
    row.oncontextmenu = (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      showMenu(ev.clientX, ev.clientY, entryMenu(e.path, e.isDir))
    }
    if (e.isDir) {
      const kids = document.createElement('div')
      kids.hidden = true
      into.append(kids)
      const setOpen = async (open: boolean): Promise<void> => {
        kids.hidden = !open
        twisty.innerHTML = open ? icons.chevronDown : icons.chevronRight
        row.querySelector('.ficon')?.replaceWith(...new DOMParser().parseFromString(folderIcon(e.name, open), 'text/html').body.children)
        if (open && kids.childElementCount === 0) await renderDir(e.path, kids, depth + 1)
        if (open) {
          kids.classList.remove('kids-enter')
          void kids.offsetWidth
          kids.classList.add('kids-enter')
        }
      }
      dirs.set(norm(e.path), { kids, depth, setOpen })
      row.onclick = () => void guarded(`Read ${e.name}`, () => setOpen(kids.hidden))
    } else {
      row.onclick = () => {
        treeEl.querySelectorAll('.node.active').forEach((n) => n.classList.remove('active'))
        row.classList.add('active')
        void openFile(e.path)
      }
    }
  }
  decorateTree()
}

/** Expands the tree down to `path` and selects it. */
async function locateInTree(path: string): Promise<void> {
  if (!rootDir) return
  const parts = relPath(path).split(/[\\/]/)
  let dir = rootDir
  for (const part of parts.slice(0, -1)) {
    dir = joinPath(dir, part)
    const d = dirs.get(norm(dir))
    if (!d?.setOpen) return // outside the project
    if (d.kids.hidden) await d.setOpen(true)
  }
  const node = [...treeEl.querySelectorAll<HTMLElement>('.node')].find((n) => samePath(n.dataset['path'] ?? '', path))
  if (!node) return
  treeEl.querySelectorAll('.node.active').forEach((n) => n.classList.remove('active'))
  node.classList.add('active')
  node.scrollIntoView({ block: 'nearest' })
}

async function collapseTree(): Promise<void> {
  for (const [key, d] of dirs) if (d.setOpen && !d.kids.hidden && key !== norm(rootDir ?? '')) await d.setOpen(false)
}

/** Re-reads one directory's listing. Expanded subfolders inside it collapse. */
async function refreshDir(dir: string): Promise<void> {
  const key = norm(dir)
  const d = dirs.get(key)
  if (!d) return
  for (const k of [...dirs.keys()]) if (k.startsWith(key + '/')) dirs.delete(k)
  const wasEmpty = d.kids.childElementCount === 0
  d.kids.replaceChildren()
  // A folder that was never expanded stays lazy.
  if (wasEmpty && d.kids.hidden) return
  await renderDir(dir, d.kids, d.depth + 1)
}

const joinPath = (dir: string, name: string): string => `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`

function checkName(name: string): void {
  if (/[\\/:*?"<>|]/.test(name)) throw new Error(`Invalid name: ${name}`)
}

/** Open files at or under `path`. Refuses if any have unsaved edits; otherwise closes them. */
function closeFilesUnder(path: string): void {
  const key = norm(path)
  const affected = [...openFiles.values()].filter((f) => {
    const k = norm(f.path)
    return k === key || k.startsWith(key + '/')
  })
  const dirty = affected.find(isDirty)
  if (dirty) throw new Error(`Save or close ${basename(dirty.path)} first — it has unsaved changes`)
  affected.forEach(closeFile)
}

async function createEntry(dir: string, kind: 'file' | 'folder'): Promise<void> {
  const name = await askText(kind === 'file' ? 'New file' : 'New folder')
  if (!name) return
  await guarded(`Create ${name}`, async () => {
    checkName(name)
    const path = joinPath(dir, name)
    if (kind === 'file') await window.forge.createFile(path)
    else await window.forge.createDir(path)
    await refreshDir(dir)
    refreshGit()
    report(`Created ${path}`)
    if (kind === 'file') await openFile(path)
  })
}

async function renameEntry(path: string): Promise<void> {
  const name = await askText('Rename', basename(path))
  if (!name || name === basename(path)) return
  await guarded(`Rename ${basename(path)}`, async () => {
    checkName(name)
    closeFilesUnder(path)
    const parent = parentOf(path)
    await window.forge.rename(path, joinPath(parent, name))
    await refreshDir(parent)
    refreshGit()
    report(`Renamed to ${name}`)
  })
}

async function deleteEntry(path: string): Promise<void> {
  if (settings.get<boolean>('confirmDelete') && !confirm(`Move "${basename(path)}" to the Recycle Bin?`)) return
  await guarded(`Delete ${basename(path)}`, async () => {
    closeFilesUnder(path)
    await window.forge.trash(path)
    await refreshDir(parentOf(path))
    refreshGit()
    report(`Moved ${basename(path)} to the Recycle Bin`)
  })
}

function entryMenu(path: string, isDir: boolean): (MenuItem | 'sep')[] {
  const target = isDir ? path : parentOf(path)
  return [
    { label: 'New File…', run: () => void createEntry(target, 'file') },
    { label: 'New Folder…', run: () => void createEntry(target, 'folder') },
    'sep',
    { label: 'Rename…', run: () => void renameEntry(path) },
    { label: 'Delete', danger: true, run: () => void deleteEntry(path) },
    'sep',
    { label: 'Copy Path', run: () => void window.forge.copyText(path) },
    { label: 'Copy Relative Path', run: () => void window.forge.copyText(relPath(path)) },
    { label: 'Reveal in File Explorer', run: () => void window.forge.reveal(path) }
  ]
}

// Right-click on empty tree space acts on the project root.
treeEl.oncontextmenu = (ev) => {
  if (!rootDir) return
  const root = rootDir
  ev.preventDefault()
  showMenu(ev.clientX, ev.clientY, [
    { label: 'New File…', run: () => void createEntry(root, 'file') },
    { label: 'New Folder…', run: () => void createEntry(root, 'folder') }
  ])
}

async function openFolder(): Promise<void> {
  const dir = await window.forge.openFolder()
  if (dir) await openFolderAt(dir)
}

async function openFolderAt(dir: string): Promise<void> {
  await guarded('Open folder', async () => {
    dir = await window.forge.realpath(dir) // before anything is addressed by this path (see fs:realpath)
    treeEl.replaceChildren()
    dirs.clear()
    dirs.set(norm(dir), { kids: treeEl, depth: -1 })
    rootDir = dir
    bookmarks.refresh()
    await renderDir(dir, treeEl)
    document.title = `${basename(dir)} – Forge`
    $('project-name').textContent = basename(dir)
    $('tree-title').textContent = basename(dir)
    report(`Opened ${dir}`)
    session.addRecent(dir)
    session.update({ lastFolder: dir })
    renderRecents()
  })
  refreshGit()
}

function updateStatus(): void {
  const model = active && !active.diff ? editor.getModel() : null
  const pos = editor.getPosition()
  stPos.textContent = model && pos ? `${pos.lineNumber}:${pos.column}` : ''
  stEol.textContent = model ? (model.getEOL() === '\r\n' ? 'CRLF' : 'LF') : ''
  stLang.textContent = model ? model.getLanguageId() : ''
  stIndent.textContent = model ? (model.getOptions().insertSpaces ? `${model.getOptions().tabSize} spaces` : `Tab size ${model.getOptions().tabSize}`) : ''
  refreshBlame()
}
editor.onDidChangeModelOptions(updateStatus)
editor.onDidChangeCursorPosition(updateStatus)
editor.onDidChangeModel(updateStatus)
editor.onDidChangeModelContent(refreshBlame)

// Clickable status bar widgets, like the JetBrains ones.
const LANGUAGES: [string, string][] = [
  ['plaintext', 'Plain Text'], ['typescript', 'TypeScript'], ['javascript', 'JavaScript'], ['json', 'JSON'], ['html', 'HTML'],
  ['css', 'CSS'], ['markdown', 'Markdown'], ['python', 'Python'], ['c', 'C'], ['cpp', 'C++'], ['mort', 'Mort'],
  ['shell', 'Shell Script'], ['yaml', 'YAML'], ['xml', 'XML'], ['sql', 'SQL'], ['rust', 'Rust'], ['go', 'Go'], ['java', 'Java']
]
const editorModel = (): monaco.editor.ITextModel | null => (active && !active.diff ? editor.getModel() : null)
const widgetMenu = (el: HTMLElement, items: (MenuItem | 'sep')[]): void => {
  const box = el.getBoundingClientRect()
  showMenu(box.left, box.top - 4 - items.length * 30, items)
}
stPos.onclick = () => {
  if (editorModel()) void editor.getAction('editor.action.gotoLine')?.run()
}
stEol.onclick = () => {
  const model = editorModel()
  if (!model) return
  widgetMenu(stEol, [
    { label: 'LF (Unix, macOS)', run: () => { model.pushEOL(monaco.editor.EndOfLineSequence.LF); updateStatus() } },
    { label: 'CRLF (Windows)', run: () => { model.pushEOL(monaco.editor.EndOfLineSequence.CRLF); updateStatus() } }
  ])
}
stIndent.onclick = () => {
  const model = editorModel()
  if (!model) return
  const spaces = (n: number): MenuItem => ({ label: `${n} spaces`, run: () => model.updateOptions({ tabSize: n, insertSpaces: true }) })
  widgetMenu(stIndent, [
    spaces(2), spaces(4), spaces(8),
    { label: 'Tabs', run: () => model.updateOptions({ insertSpaces: false }) },
    'sep',
    { label: 'Convert indentation to spaces', run: () => void editor.getAction('editor.action.indentationToSpaces')?.run() },
    { label: 'Convert indentation to tabs', run: () => void editor.getAction('editor.action.indentationToTabs')?.run() }
  ])
}
stLang.onclick = () => {
  const model = editorModel()
  if (!model) return
  const items = LANGUAGES.map(([id, label]): MenuItem => ({ label, run: () => { monaco.editor.setModelLanguage(model, id); updateStatus() } }))
  showMenu(stLang.getBoundingClientRect().left - 60, 80, items)
}

$('project-widget').onclick = () => void openFolder()
// Welcome screen actions
for (const el of document.querySelectorAll<HTMLElement>('#welcome .wi')) el.innerHTML = icons[el.dataset['ico'] as 'folder' | 'search' | 'command' | 'gear']
$('w-open').onclick = () => void openFolder()
$('w-search').onclick = () => void openSearch()
$('w-palette').onclick = () => palette.open()
$('w-settings').onclick = () => settingsUi.open()
{
  const bar = $('tree-bar')
  const btn = (title: string, html: string, run: () => void): void => {
    const b = document.createElement('button')
    b.className = 'icon-btn small'
    b.title = title
    b.innerHTML = html
    b.onclick = run
    bar.append(b)
  }
  const label = document.createElement('span')
  label.className = 'tool-title'
  label.id = 'tree-title'
  bar.append(label)
  btn('New file in the project root', icons.newFile, () => rootDir && void createEntry(rootDir, 'file'))
  btn('Select the open file', icons.locate, () => active && !active.diff && void locateInTree(active.path))
  btn('Collapse all', icons.collapseAll, () => void collapseTree())
}
$('search-btn').onclick = () => void openSearch()
document.querySelectorAll<HTMLButtonElement>('[data-hide]').forEach((b) => {
  b.onclick = () => tw.hideDock(b.dataset['hide'] as DockName)
})

const isMac = navigator.platform.startsWith('Mac')
if (isMac) document.body.classList.add('mac') // window buttons are on the left there

window.addEventListener('keydown', (e) => {
  // Physical keys (e.code): on macOS, Alt+1 types a symbol, so e.key would never be "1".
  const digit = e.altKey && !e.ctrlKey && !e.metaKey ? /^Digit([012367])$/.exec(e.code)?.[1] : undefined
  if (digit !== undefined) {
    e.preventDefault()
    tw.toggle({ '0': 'commit', '1': 'project', '2': 'output', '3': 'terminal', '6': 'problems', '7': 'structure' }[digit]!)
    return
  }
  if (e.key === 'F11' && e.shiftKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault()
    bookmarks.list()
    return
  }
  if (e.key === 'F11' && e.ctrlKey && !e.shiftKey && !e.altKey) {
    e.preventDefault()
    bookmarks.toggle()
    return
  }
  if (e.key === 'F11') {
    e.preventDefault()
    void window.forge.toggleFullscreen()
    return
  }
  // Cmd is the "Ctrl" of macOS.
  if (!(e.ctrlKey || (isMac && e.metaKey))) return
  if (e.code === 'Comma' && !e.shiftKey && !e.altKey) { e.preventDefault(); settingsUi.open(); return }
  if (e.altKey && !e.shiftKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    e.preventDefault()
    void (e.code === 'ArrowLeft' ? nav.back() : nav.forward()).catch(() => undefined) // reported by the opener
    return
  }
  if (e.code === 'KeyE' && !e.altKey) { e.preventDefault(); if (e.shiftKey) nav.recentLocations(); else nav.recentFiles(); return }
  if (e.altKey && e.code === 'KeyS') { e.preventDefault(); settingsUi.open(); return }
  if (e.altKey && e.code === 'KeyZ') { e.preventDefault(); toggleZen(); return }
  if (e.shiftKey && e.code === 'KeyP') { e.preventDefault(); palette.open(); return }
  if (e.shiftKey && e.key === 'F') { e.preventDefault(); showView('find'); return }
  // e.code, not e.key: with Shift held the key reports '~' (and layouts differ).
  if (e.code === 'Backquote' && e.shiftKey) { e.preventDefault(); showView('terminal'); terminals.newTerminal(); return }
  if (e.code === 'Backquote') { e.preventDefault(); toggleView('terminal'); return }
  if (e.key === 'o') { e.preventDefault(); void openFolder() }
  else if (e.key === 's') { e.preventDefault(); void saveActive() }
  else if (e.key === 'w' && active) { e.preventDefault(); requestClose(active) }
})

const stProblems = $('st-problems')
const lsp = initLsp({
  editor,
  getModel: (path) => [...openFiles.values()].find((f) => !f.diff && samePath(f.path, path))?.model,
  showUsages: (symbol, hits) => {
    showView('find')
    finder.show(`${hits.length} usage${hits.length === 1 ? '' : 's'} of ${symbol || 'symbol'}`, symbol, hits)
  },
  getRoot: () => rootDir,
  openFile,
  report,
  onProblems: (errors, warnings) => {
    stProblems.textContent = errors || warnings ? `✕ ${errors}  ⚠ ${warnings}` : ''
    stProblems.classList.toggle('has-errors', errors > 0)
  }
})

const structure = initStructure({
  root: $('view-structure'),
  editor,
  getSymbols: (model) => lsp.documentSymbols(model),
  isVisible: () => tw.isOpen('structure')
})
tw.setOnShow('structure', () => void structure.refresh())
initQuick({ restoreFocus: () => (active ? editor.focus() : undefined) })
const nav = initNavigation({
  editor,
  currentPath: () => (active && !active.diff ? active.path : null),
  openAt: openFile,
  relPath,
  lineText: (path, line) => {
    const m = [...openFiles.values()].find((f) => !f.diff && samePath(f.path, path))?.model
    return m && line <= m.getLineCount() ? m.getLineContent(line) : undefined
  },
  getRoot: () => rootDir,
  onChange: () => {
    ;($('nav-back') as HTMLButtonElement).disabled = !nav.canBack()
    ;($('nav-forward') as HTMLButtonElement).disabled = !nav.canForward()
  }
})
const bookmarks = initBookmarks({
  editor,
  root: $('view-bookmarks'),
  currentPath: () => (active && !active.diff ? active.path : null),
  getModel: (path) => [...openFiles.values()].find((f) => !f.diff && samePath(f.path, path))?.model,
  openAt: openFile,
  relPath,
  getRoot: () => rootDir,
  onCount: (n) => tw.setBadge('bookmarks', n ? String(n) : '')
})
setIcon('#nav-back', icons.back)
setIcon('#nav-forward', icons.forward)
$('nav-back').onclick = () => void nav.back().catch(() => undefined) // reported by the opener
$('nav-forward').onclick = () => void nav.forward().catch(() => undefined)
window.addEventListener('mouseup', (e) => {
  // The mouse's back/forward buttons.
  if (e.button === 3) void nav.back().catch(() => undefined)
  else if (e.button === 4) void nav.forward().catch(() => undefined)
})

const breadcrumbs = initBreadcrumbs({
  el: $('breadcrumbs'),
  editor,
  currentPath: () => (active && !active.diff ? relPath(active.path) : null),
  getSymbols: (model) => lsp.documentSymbols(model)
})
initProblems({
  root: $('view-problems'),
  relPath,
  openAt: openFile,
  onCounts: (errors, warnings) => tw.setBadge('problems', String(errors || warnings || ''), errors ? 'err' : 'warn')
})
stProblems.onclick = () => showView('problems')

const terminals = initTerminals({ getCwd: () => rootDir, guard: guarded })
tw.setOnShow('terminal', () => terminals.show())

const findInput = $<HTMLInputElement>('find-input')
const finder = initFind({
  input: findInput,
  results: $('find-results'),
  count: $('find-count'),
  getRoot: () => rootDir,
  relPath,
  openAt: openFile,
  guard: guarded
})
tw.setOnShow('find', () => findInput.focus())

// ---- Git ----
const gitKinds = new Map<string, ChangeKind>() // normalized path -> change kind

function decorateTree(): void {
  treeEl.querySelectorAll<HTMLElement>('.node[data-path]').forEach((n) => {
    const kind = gitKinds.get(norm(n.dataset['path'] ?? '').toLowerCase())
    if (kind) n.dataset['git'] = kind
    else delete n.dataset['git']
  })
}

function refreshBlame(): void {
  const f = active && !active.diff ? active : null
  gitUi.updateBlame(f ? f.path : null, editor.getPosition()?.lineNumber ?? 1, f ? isDirty(f) : false)
}

/** Opens (or refreshes) a HEAD-vs-working-copy diff tab. The right side edits the real file. */
async function openDiff(path: string, kind: ChangeKind): Promise<void> {
  const root = rootDir
  if (!root) return
  await guarded(`Diff ${basename(path)}`, async () => {
    // Renamed files: the old path isn't tracked here, so the whole file shows as added.
    const isNew = kind === 'added' || kind === 'untracked' || kind === 'renamed'
    const original = isNew ? '' : await window.forge.gitShow(root, path)
    const existing = openFiles.get(`diff:${path}`)
    if (existing?.diff) {
      existing.diff.original.setValue(original)
      activate(existing)
      return
    }
    // The diff edits the real file, so the file has to be open; a deleted file has nothing to open.
    let shared: OpenFile | undefined
    if (kind !== 'deleted') {
      await openFile(path)
      shared = [...openFiles.values()].find((f) => !f.diff && samePath(f.path, path))
      if (!shared) throw new Error(`Could not open ${basename(path)} to show its diff`)
    }
    const uriPath = '/' + norm(path)
    const f: OpenFile = {
      path,
      savedVersion: 0,
      model: shared ? shared.model : monaco.editor.createModel('', undefined, monaco.Uri.from({ scheme: 'forge-diff', path: uriPath })),
      diff: { original: monaco.editor.createModel(original, undefined, monaco.Uri.from({ scheme: 'forge-head', path: uriPath })), shared }
    }
    f.savedVersion = f.model.getAlternativeVersionId()
    openFiles.set(tabKey(f), f)
    activate(f)
  })
}

/** After a commit or branch switch: diffs are stale snapshots, and files on disk may have changed. */
async function onWorktreeChanged(): Promise<void> {
  for (const f of [...openFiles.values()]) if (f.diff) closeFile(f)
  for (const f of [...openFiles.values()]) {
    if (isDirty(f)) continue // never clobber unsaved edits
    try {
      const text = await window.forge.readFile(f.path)
      if (text !== f.model.getValue()) {
        f.model.setValue(text)
        f.savedVersion = f.model.getAlternativeVersionId()
      }
    } catch (err) {
      report(`Reload ${basename(f.path)}: ${err instanceof Error ? err.message : String(err)}`, true)
    }
  }
  if (rootDir) await refreshDir(rootDir)
}

const gitUi = initGit({
  getRoot: () => rootDir,
  report,
  guard: guarded,
  openDiff,
  onStatus: (changes: GitChange[]) => {
    gitKinds.clear()
    for (const c of changes) gitKinds.set(norm(c.path).toLowerCase(), c.kind)
    decorateTree()
    refreshBlame()
  },
  onWorktreeChanged
})

/** Fire-and-forget refresh; gitUi.refresh() already reports its own failures. */
function refreshGit(): void {
  void gitUi.refresh().catch(() => undefined)
}
tw.setOnShow('commit', refreshGit)
window.addEventListener('focus', () => {
  if (settings.get<boolean>('gitRefreshOnFocus')) refreshGit() // changes made outside Forge
})

// ---- Run ----
/** Saves every modified file so a run never executes stale code from disk. */
async function saveAllDirty(): Promise<void> {
  for (const f of openFiles.values()) {
    if (f.diff || !isDirty(f)) continue // a diff tab shares its file's model, which is saved via the file tab
    await window.forge.writeFile(f.path, f.model.getValue())
    f.savedVersion = f.model.getAlternativeVersionId()
  }
  renderTabs()
}

const runView = createTerminalView($('run-term'), () => rootDir, guarded, {
  autoStart: false,
  exitMessage: (code) => `Process finished with exit code ${code}`,
  onExit: (code) => {
    report(`Process finished with exit code ${code}`)
    runUi.updateButtons()
  }
})

const runUi = initRun({
  getRoot: () => rootDir,
  getActivePath: () => (active && !active.diff ? active.path : null),
  saveAll: saveAllDirty,
  report,
  guard: guarded,
  openFile,
  view: runView,
  showRunView: () => showView('run')
})
tw.setOnShow('run', () => runView.show())

const dbg = initDebug({
  editor,
  getModel: (path) => [...openFiles.values()].find((f) => !f.diff && samePath(f.path, path))?.model,
  getActivePath: () => (active && !active.diff ? active.path : null),
  openFile,
  report,
  guard: guarded,
  resolveDebug: () => runUi.resolveSelected(true),
  saveAll: saveAllDirty,
  runView,
  showView: (v) => showView(v),
  stop: runUi.stop,
  setBusy: runUi.setBusy
})
$('debug-btn').onclick = () => void dbg.start().catch(() => undefined) // reported by guard

// Capture phase: Monaco claims several F-keys (e.g. F8) before they would bubble to the window.
window.addEventListener(
  'keydown',
  (e) => {
    const act = (fn: () => void): void => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    const quiet = (p: Promise<unknown>): void => void p.catch(() => undefined) // errors are reported by guard
    // Exact modifier matches only: this runs before Monaco, so a loose match would steal keys such as
    // Alt+F7 (Find Usages) or Shift+F12 from the editor.
    const mods = (ctrl: boolean, shift: boolean, alt: boolean): boolean =>
      e.ctrlKey === ctrl && e.shiftKey === shift && e.altKey === alt && !e.metaKey
    if (e.key === 'F10' && mods(false, true, false)) act(() => quiet(runUi.run()))
    else if (e.key === 'F9' && mods(false, true, false)) act(() => quiet(dbg.start()))
    else if (e.key === 'F9' && mods(false, false, false)) act(() => quiet(dbg.control('resume')))
    else if (e.key === 'F8' && mods(true, false, false)) act(() => dbg.toggleAtCursor())
    else if (e.key === 'F8' && mods(false, true, false)) act(() => quiet(dbg.control('stepOut')))
    else if (e.key === 'F8' && mods(false, false, false)) act(() => quiet(dbg.control('stepOver')))
    else if (e.key === 'F7' && mods(false, false, false)) act(() => quiet(dbg.control('stepInto')))
    else if (e.key === 'F2' && mods(true, false, false)) act(() => quiet(runUi.stop()))
    else if (e.key === 'F1' && mods(false, false, false)) act(() => palette.open())
  },
  true
)

// ---- Settings, command palette, auto save ----
// The window is closing: write pending settings and session first, then tell the main process it may close.
window.forge.onFlush(() => {
  bookmarks.snapshot() // lines may have moved since the last save
  Promise.all([flushSettings(), session.flush()])
    .catch((err: unknown) => console.error('Flush on close failed', err)) // closing must not hang on this
    .finally(() => window.forge.flushed())
})
settings.onSaveError = (err) => report(`Saving settings: ${err.message}`, true)
session.onError = (err) => report(`Saving session: ${err.message}`, true)
for (const problem of settings.problems) report(problem, true) // a broken settings.json or theme file is never silent

function toggleZen(): void {
  document.body.classList.toggle('zen') // hides everything but the editor; the layout adapts by itself
}

async function openCustomCss(): Promise<void> {
  await openFile(await window.forge.ensureCustomCss())
}

const settingsUi = initSettingsUi({ openFile, report, openCustomCss })
const palette = initPalette({ report })
registerBuiltinCommands({
  openFolder,
  saveActive: () => saveActive(),
  closeActiveTab: () => {
    if (active) requestClose(active)
  },
  openSearch: () => void openSearch(),
  showFind: () => showView('find'),
  toggleSide,
  toggleView,
  navBack: () => void nav.back().catch(() => undefined),
  navForward: () => void nav.forward().catch(() => undefined),
  recentFiles: () => nav.recentFiles(),
  recentLocations: () => nav.recentLocations(),
  toggleBookmark: () => bookmarks.toggle(),
  showBookmarks: () => bookmarks.list(),
  newTerminal: () => {
    showView('terminal')
    terminals.newTerminal()
  },
  toggleZen,
  toggleFullscreen: async () => void (await window.forge.toggleFullscreen()),
  openSettings: (category) => settingsUi.open(category),
  openSettingsFile: async () => {
    await ensureSettingsFile()
    await openFile(userData.settingsPath)
  },
  openThemesDir: async () => void (await window.forge.openThemesDir()),
  openCustomCss,
  run: () => runUi.run(),
  debug: () => dbg.start(),
  stop: () => runUi.stop(),
  control: (cmd) => dbg.control(cmd),
  toggleBreakpoint: () => dbg.toggleAtCursor(),
  editRunConfigs: () => runUi.editConfigs(),
  editorAction: (id) => void editor.getAction(id)?.run(),
  git: (what) => {
    if (what === 'refresh') refreshGit()
    else $(`commit-${what}`).click()
  }
})
keymap.init(report) // custom shortcuts, now that every command exists
initExtensions({
  report,
  editor: {
    getText: () => (active && !active.diff ? active.model.getValue() : null),
    getSelectedText: () => {
      const model = editor.getModel()
      const sel = editor.getSelection()
      return model && sel ? model.getValueInRange(sel) : ''
    },
    replaceSelection: (text) => {
      const sel = editor.getSelection()
      if (sel) editor.executeEdits('extension', [{ range: sel, text, forceMoveMarkers: true }])
    },
    insertText: (text) => {
      const p = editor.getPosition()
      if (p) editor.executeEdits('extension', [{ range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text, forceMoveMarkers: true }])
    },
    getFilePath: () => (active && !active.diff ? active.path : null),
    getLanguage: () => (active && !active.diff ? active.model.getLanguageId() : null),
    root: () => rootDir
  }
}).catch((err: unknown) => report(`Extensions: ${err instanceof Error ? err.message : String(err)}`, true))
$('settings-btn').onclick = () => settingsUi.open()
$('open-folder-btn').onclick = () => void openFolder()
$('palette-btn').onclick = () => palette.open()
settings.onChange((key) => {
  if (key === 'colorful') renderTabs() // tab colors are set per tab
})

// Auto save: after a pause in typing, or when the window loses focus.
let autoSaveTimer: number | undefined
editor.onDidChangeModelContent(() => {
  if (settings.get<string>('autoSave') !== 'afterDelay') return
  window.clearTimeout(autoSaveTimer)
  autoSaveTimer = window.setTimeout(() => {
    void saveActive({ format: false }).catch(() => undefined) // already reported by guarded()
  }, settings.get<number>('autoSaveDelay'))
})
window.addEventListener('blur', () => {
  if (settings.get<string>('autoSave') === 'onBlur') {
    void saveAllDirty().then(refreshGit, (err: unknown) => report(`Auto save: ${err instanceof Error ? err.message : String(err)}`, true))
  }
})

// ---- Session: reopen the last project, tabs and layout; recent projects on the welcome screen ----
let restoring = true // the session isn't saved while it's still being restored (that would overwrite it)

function saveSession(): void {
  if (restoring) return
  const layout = session.get().layout
  const width = $('project').offsetWidth
  const height = $('bottom').offsetHeight
  const rightWidth = $('right').offsetWidth
  const docks = tw.layout()
  session.update({
    openFiles: [...openFiles.values()].filter((f) => !f.diff).map((f) => f.path),
    activeFile: (active?.diff ? active.diff.shared : active)?.path,
    layout: {
      projectWidth: width > 0 ? width : layout.projectWidth, // a hidden window measures 0: keep the last real size
      bottomHeight: height > 0 ? height : layout.bottomHeight,
      rightWidth: rightWidth > 0 ? rightWidth : layout.rightWidth,
      projectHidden: docks.hidden.left,
      bottomHidden: docks.hidden.bottom,
      rightHidden: docks.hidden.right,
      side: docks.active.left,
      view: docks.active.bottom,
      docks: docks.docks,
      active: docks.active
    }
  })
}

function renderRecents(): void {
  const box = $('recents')
  box.replaceChildren()
  const list = session.get().recents
  if (!list.length) return
  const h = document.createElement('h4')
  h.textContent = 'Recent projects'
  box.append(h)
  list.forEach((dir, i) => {
    const b = document.createElement('button')
    b.className = 'recent'
    b.style.setProperty('--i', String(i))
    const avatar = document.createElement('span')
    avatar.className = 'avatar'
    avatar.textContent = basename(dir).slice(0, 2).toUpperCase()
    // A stable hue per project, so each recent project keeps its own color.
    let hue = 0
    for (const ch of dir) hue = (hue * 31 + ch.charCodeAt(0)) % 360
    avatar.style.setProperty('--h', String(hue))
    const label = document.createElement('span')
    label.className = 'rlabel'
    const name = document.createElement('span')
    name.className = 'rn'
    name.textContent = basename(dir)
    const where = document.createElement('span')
    where.className = 'rp'
    where.textContent = dir
    label.append(name, where)
    b.append(avatar, label)
    b.onclick = () => void openFolderAt(dir).catch(() => undefined) // reported by guarded()
    box.append(b)
  })
}

async function restoreSession(): Promise<void> {
  const s = session.get()
  renderRecents()
  try {
    if (!settings.get<boolean>('restoreSession') || !s.lastFolder) return
    const l = s.layout
    if (l.projectWidth) $('project').style.width = `${l.projectWidth}px`
    if (l.bottomHeight) $('bottom').style.height = `${l.bottomHeight}px`
    if (l.rightWidth) $('right').style.width = `${l.rightWidth}px`
    // Only the passive windows come back as the shown tab; a terminal, run or debug session shouldn't start unasked.
    tw.restore({
      docks: l.docks,
      active: { left: l.active?.left ?? l.side, bottom: l.active?.bottom ?? l.view, right: l.active?.right },
      hidden: { left: l.projectHidden, bottom: l.bottomHidden, right: l.rightHidden }
    })
    try {
      await openFolderAt(s.lastFolder)
    } catch {
      session.removeRecent(s.lastFolder) // reported by guarded(); don't keep trying a folder that is gone
      renderRecents()
      return
    }
    for (const path of s.openFiles) {
      try {
        await openFile(path)
      } catch {
        // A file that was deleted since last time is reported by guarded(); the others still reopen.
      }
    }
    if (s.activeFile) await openFile(s.activeFile).catch(() => undefined) // reported by guarded()
  } finally {
    restoring = false
    saveSession()
    if (tw.isOpen('structure')) void structure.refresh()
  }
}

renderTabs()
void restoreSession()
