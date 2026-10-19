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
import { initRipples, notifications, shouldToast, toast } from './effects'
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
import { initQuick, quickPick } from './quick'
import { initNavigation } from './navigation'
import { initBookmarks } from './bookmarks'
import { initSearchEverywhere, type SearchScope } from './searchall'
import { initHierarchy } from './hierarchy'
import { initTemplates, templateProblems } from './templates'
import { initHistory } from './history'
import { initGitLog } from './gitlog'
import { initConflicts } from './conflicts'
import { initGutter } from './gutter'
import { initTodo } from './todo'
import { initPreview } from './preview'
import { initBreakpointsWindow } from './breakpoints'
import { initHttpClient } from './httpclient'
import { initTestRunner } from './testrunner'
import { formatForSave, initEditorConfig } from './editorconfig'
import { initAnnotate } from './annotate'
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
  /** The text last known to be on disk (read or written by Forge); a file tab only. Tells our own writes from outside changes. */
  savedText?: string
  /** An image file: shown in the image viewer instead of the text editor. */
  image?: { url: string; bytes: number }
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
  renderSideBySide: true,
  useInlineViewWhenSpaceIsLimited: false // always two panes, even in a narrow window
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
  notifications.add(msg, isError)
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
tw.register({ id: 'breakpoints', title: 'Breakpoints', icon: icons.breakpoint, root: $('view-breakpoints'), dock: 'bottom', shortcut: 'Ctrl+Shift+F8' })
tw.register({ id: 'http', title: 'Response', icon: icons.http, root: $('view-http'), dock: 'bottom' })
tw.register({ id: 'todo', title: 'TODO', icon: icons.todo, root: $('view-todo'), dock: 'bottom' })
tw.register({ id: 'git', title: 'Git', icon: icons.git, root: $('view-git'), dock: 'bottom', shortcut: 'Alt+9' })
tw.register({ id: 'problems', title: 'Problems', icon: icons.problems, root: $('view-problems'), dock: 'bottom', shortcut: 'Alt+6' })
tw.register({ id: 'hierarchy', title: 'Hierarchy', icon: icons.hierarchy, root: $('view-hierarchy'), dock: 'bottom' })
tw.register({ id: 'structure', title: 'Structure', icon: icons.structure, root: $('view-structure'), dock: 'right', shortcut: 'Alt+7' })
tw.register({ id: 'preview', title: 'Preview', icon: icons.preview, root: $('view-preview'), dock: 'right' })
tw.register({ id: 'bookmarks', title: 'Bookmarks', icon: icons.bookmark, root: $('view-bookmarks'), dock: 'right' })

type View = 'output' | 'terminal' | 'find' | 'run' | 'debug' | 'problems' | 'structure' | 'bookmarks' | 'hierarchy' | 'git' | 'todo' | 'preview' | 'breakpoints' | 'http'
type Side = 'project' | 'commit'
const showSide = (side: Side): void => tw.show(side)
const toggleSide = (side: Side): void => tw.toggle(side)
const showView = (view: View): void => tw.show(view)
const toggleView = (view: View): void => tw.toggle(view)

// ---- Search Everywhere ----
function relPath(p: string): string {
  // Case-insensitive: language servers report a lowercase drive letter ("c:\...") where the root has "C:\...".
  return rootDir && p.toLowerCase().startsWith(rootDir.toLowerCase()) ? p.slice(rootDir.length + 1) : p
}

const searchAll = initSearchEverywhere({
  getRoot: () => rootDir,
  relPath,
  openFile,
  listFiles: (root) => window.forge.listFiles(root),
  symbols: (query) => lsp.workspaceSymbols(query),
  report,
  restoreFocus: () => (active ? editor.focus() : undefined)
})
const openSearch = (scope: SearchScope = 'all', opts?: { classesOnly?: boolean }): Promise<void> => searchAll.open(scope, opts)

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
    { label: 'Reveal in File Explorer', run: () => void window.forge.reveal(f.path) },
    ...(f.diff ? [] : [{ label: 'Git History', run: () => showFileHistory(f.path) }])
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
  $('editor').hidden = !!f?.diff || !!f?.image
  $('diff').hidden = !f?.diff
  showImage(f?.image ? f : null)
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

/** Fills the image viewer (click toggles between fit-to-window and actual size). */
function showImage(f: OpenFile | null): void {
  const view = $('image-view')
  view.hidden = !f
  view.classList.remove('actual')
  if (!f?.image) return view.replaceChildren()
  const img = document.createElement('img')
  img.src = f.image.url
  const info = document.createElement('div')
  info.className = 'info'
  const kb = f.image.bytes / 1024
  info.textContent = `${basename(f.path)} · ${kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`}`
  img.onload = () => (info.textContent = `${basename(f.path)} · ${img.naturalWidth} × ${img.naturalHeight} · ${kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`}`)
  img.onclick = () => view.classList.toggle('actual')
  view.replaceChildren(img, info)
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

const editorConfig = initEditorConfig({
  getRoot: () => rootDir,
  exists: (p) => window.forge.exists(p),
  readFile: (p) => window.forge.readFile(p)
})

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i

async function openFile(path: string, line?: number, column = 1): Promise<void> {
  const existing = [...openFiles.values()].find((f) => !f.diff && samePath(f.path, path))
  if (existing) activate(existing)
  else if (IMAGE_EXT.test(path)) {
    await guarded(`Open ${basename(path)}`, async () => {
      const image = await window.forge.readDataUrl(path)
      // An image has no text, but the tab machinery wants a model: an empty one that can never be edited.
      const model = monaco.editor.createModel('', 'plaintext', monaco.Uri.from({ scheme: 'forge-image', path: '/' + norm(path) }))
      const f: OpenFile = { path, model, savedVersion: model.getAlternativeVersionId(), image }
      openFiles.set(path, f)
      activate(f)
    })
  } else {
    await guarded(`Open ${basename(path)}`, async () => {
      const text = await window.forge.readFile(path)
      history.record(path, text) // the version as it was when opened
      const model = monaco.editor.createModel(text, undefined, monaco.Uri.file(path))
      const f: OpenFile = { path, model, savedVersion: model.getAlternativeVersionId(), savedText: text }
      // .editorconfig decides this file's indentation (before anything is typed).
      void editorConfig
        .resolve(path)
        .then((ec) => {
          if (model.isDisposed()) return
          model.updateOptions({
            ...(ec.indentStyle ? { insertSpaces: ec.indentStyle === 'space' } : {}),
            ...(ec.indentSize ? { tabSize: ec.indentSize, indentSize: ec.indentSize } : {})
          })
          updateStatus()
        })
        .catch((err: unknown) => report(`.editorconfig: ${err instanceof Error ? err.message : String(err)}`, true))
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
  if (!f || f.image) return // an image has no text to save
  await guarded(`Save ${basename(f.path)}`, async () => {
    // Format first when asked to (not for auto-save, which would move the text under the cursor), and only
    // when the editor is showing this file. A language without a formatter is skipped quietly.
    if (opts.format !== false && settings.get<boolean>('formatOnSave') && active && !active.diff) {
      await lsp.quietFormat(async () => {
        await editor.getAction('editor.action.formatDocument')?.run()
      })
    }
    // .editorconfig: line endings, trailing whitespace and the final newline are fixed as the file is saved.
    const ec = await editorConfig.resolve(f.path)
    if (ec.endOfLine) f.model.setEOL(ec.endOfLine === 'crlf' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
    const tidy = formatForSave(f.model.getValue(), { ...ec, endOfLine: undefined })
    if (tidy !== f.model.getValue()) {
      f.model.pushStackElement()
      f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text: tidy }], () => null)
      f.model.pushStackElement()
    }
    const value = f.model.getValue()
    const version = f.model.getAlternativeVersionId() // what was written; anything typed during the write is still unsaved
    await window.forge.writeFile(f.path, value)
    f.savedText = value
    history.record(f.path, value)
    if (basename(f.path) === '.editorconfig') editorConfig.clear()
    if (samePath(f.path, userData.customCssPath)) setCustomCss(value) // saving custom.css restyles live
    f.savedVersion = version
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
  const showHidden = settings.get<boolean>('treeShowHidden')
  const entries = (await window.forge.readDir(dir)).filter((e) => showHidden || !e.name.startsWith('.'))
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
    row.draggable = true
    row.ondragstart = (ev) => ev.dataTransfer?.setData('text/forge-path', e.path)
    if (e.isDir) {
      row.ondragover = (ev) => {
        if (!ev.dataTransfer?.types.includes('text/forge-path')) return
        ev.preventDefault()
        ev.stopPropagation()
        row.classList.add('drop')
      }
      row.ondragleave = () => row.classList.remove('drop')
      row.ondrop = (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        row.classList.remove('drop')
        const from = ev.dataTransfer?.getData('text/forge-path')
        if (from) void moveEntry(from, e.path)
      }
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

/** Re-reads one directory's listing. Subfolders that were expanded inside it stay expanded. */
async function refreshDir(dir: string): Promise<void> {
  const key = norm(dir)
  const d = dirs.get(key)
  if (!d) return
  // Nothing to do if the folder's listing is what is already shown (watching reports folders that were merely read).
  if (d.kids.childElementCount > 0) {
    const shown = new Set([...d.kids.children].filter((c) => c.classList.contains('node')).map((c) => norm((c as HTMLElement).dataset['path'] ?? '')))
    const showHidden = settings.get<boolean>('treeShowHidden')
    const entries = (await window.forge.readDir(dir)).filter((e) => showHidden || !e.name.startsWith('.'))
    if (entries.length === shown.size && entries.every((e) => shown.has(norm(e.path)))) return
  }
  // Shallowest first, so each parent is open again before its children are.
  const open = [...dirs.entries()].filter(([k, x]) => k.startsWith(key + '/') && x.setOpen && !x.kids.hidden).map(([k]) => k).sort((a, b) => a.length - b.length)
  for (const k of [...dirs.keys()]) if (k.startsWith(key + '/')) dirs.delete(k)
  const wasEmpty = d.kids.childElementCount === 0
  // A folder that was never expanded stays lazy.
  if (wasEmpty && d.kids.hidden) return
  // Build the new rows off-screen and swap them in, so the tree is never seen half empty while the listing is read.
  const fresh = document.createElement('div')
  await renderDir(dir, fresh, d.depth + 1)
  d.kids.replaceChildren(...fresh.childNodes)
  decorateTree()
  for (const k of open) await dirs.get(k)?.setOpen?.(true)
}

// ---- Changes made outside Forge ----
let syncing = false
let syncAgain: { paths: Set<string>; git: boolean; all: boolean } | null = null

/** Brings the tree, the open files and the git status in line with what changed on disk. */
async function applyExternalChanges(paths: Set<string>, gitChanged: boolean, all = false): Promise<void> {
  if (syncing) {
    // Changes arriving while one round is running are folded into the next round.
    syncAgain ??= { paths: new Set(), git: false, all: false }
    for (const p of paths) syncAgain.paths.add(p)
    syncAgain.git ||= gitChanged
    syncAgain.all ||= all
    return
  }
  syncing = true
  try {
    // 1. the tree: re-read each folder that gained, lost or renamed something (and is shown)
    const folders = new Set<string>()
    for (const p of paths) {
      folders.add(parentOf(p))
      if (basename(p) === '.editorconfig') editorConfig.clear()
    }
    if (all) {
      // Events were lost: check every folder that is shown and every open file.
      for (const [key, d] of dirs) if (d.depth < 0 || (d.kids.childElementCount > 0 && !d.kids.hidden)) folders.add(key)
      for (const f of openFiles.values()) if (!f.diff) paths.add(f.path)
      gitChanged = true
    }
    for (const dir of folders) if (dirs.has(norm(dir))) await refreshDir(dir)
    // 2. open files: reload the ones that changed on disk, unless they have unsaved edits
    for (const p of paths) {
      const f = [...openFiles.values()].find((x) => !x.diff && !x.image && samePath(x.path, p))
      if (!f) continue
      let text: string
      try {
        text = await window.forge.readFile(f.path)
      } catch (err) {
        if ((err as { code?: string }).code === 'ENOENT' || /ENOENT/.test(String(err))) report(`${basename(f.path)} was deleted outside Forge (it stays open)`, true)
        else report(`Reload ${basename(f.path)}: ${err instanceof Error ? err.message : String(err)}`, true)
        continue
      }
      if (text === f.savedText) continue // our own write, or nothing new
      f.savedText = text
      if (text === f.model.getValue()) {
        f.savedVersion = f.model.getAlternativeVersionId() // the disk and the editor agree: nothing unsaved
        continue
      }
      if (isDirty(f)) {
        report(`${basename(f.path)} changed on disk, but you have unsaved edits here. Saving will overwrite it.`, true)
        continue
      }
      f.model.pushStackElement()
      f.model.pushEditOperations([], [{ range: f.model.getFullModelRange(), text }], () => null)
      f.model.pushStackElement()
      f.savedVersion = f.model.getAlternativeVersionId()
      report(`Reloaded ${basename(f.path)} (changed outside Forge)`)
    }
    renderTabs()
    // 3. git
    if (gitChanged || paths.size) refreshGit()
  } finally {
    syncing = false
    const next = syncAgain
    syncAgain = null
    if (next) void applyExternalChanges(next.paths, next.git, next.all).catch((err: unknown) => report(`Sync: ${String(err)}`, true))
  }
}
window.forge.onFsChanged((c) => {
  void applyExternalChanges(new Set(c.paths), c.git, c.all).catch((err: unknown) => report(`Sync with disk: ${err instanceof Error ? err.message : String(err)}`, true))
})
window.forge.onFsWatchError((m) => report(`Watching the project for changes stopped: ${m}`, true))

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

// ---- Cut / copy / paste, duplicate, move ----
let treeClip: { paths: string[]; cut: boolean } | null = null

/** "name.ext" -> "name copy.ext", "name copy 2.ext" ... the first that does not exist yet in `dir`. */
async function freeName(dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const taken = new Set((await window.forge.readDir(dir)).map((e) => e.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

async function copyEntry(from: string, toDir: string, name = basename(from)): Promise<string> {
  const dest = joinPath(toDir, await freeName(toDir, name))
  if (norm(dest).toLowerCase().startsWith(norm(from).toLowerCase() + '/')) throw new Error(`Can't copy ${basename(from)} into itself`)
  await window.forge.copy(from, dest)
  return dest
}

async function moveEntry(from: string, toDir: string): Promise<void> {
  if (samePath(parentOf(from), toDir)) return
  if (norm(toDir).toLowerCase() === norm(from).toLowerCase() || norm(toDir).toLowerCase().startsWith(norm(from).toLowerCase() + '/')) {
    report(`Can't move ${basename(from)} into itself`, true)
    return
  }
  await guarded(`Move ${basename(from)}`, async () => {
    const dest = joinPath(toDir, basename(from))
    closeFilesUnder(from)
    await window.forge.rename(from, dest)
    await refreshDir(parentOf(from))
    await refreshDir(toDir)
    refreshGit()
    report(`Moved ${basename(from)} to ${basename(toDir)}`)
  }).catch(() => undefined) // reported by guarded
}

async function pasteInto(dir: string): Promise<void> {
  const clip = treeClip
  if (!clip) return
  await guarded('Paste', async () => {
    for (const p of clip.paths) {
      if (clip.cut) await moveEntryChecked(p, dir)
      else await copyEntry(p, dir)
    }
    if (clip.cut) treeClip = null
    await refreshDir(dir)
    refreshGit()
    report(`Pasted ${clip.paths.length} item${clip.paths.length === 1 ? '' : 's'} into ${basename(dir)}`)
  }).catch(() => undefined) // reported by guarded
}

/** Like moveEntry but throws (for Paste, which reports once for the whole batch). */
async function moveEntryChecked(from: string, toDir: string): Promise<void> {
  const dest = joinPath(toDir, basename(from))
  closeFilesUnder(from)
  await window.forge.rename(from, dest)
  await refreshDir(parentOf(from))
}

async function duplicateEntry(path: string): Promise<void> {
  const dir = parentOf(path)
  const suggested = await freeName(dir, basename(path))
  const name = await askText('Duplicate as', suggested)
  if (!name) return
  await guarded(`Duplicate ${basename(path)}`, async () => {
    checkName(name)
    await window.forge.copy(path, joinPath(dir, name))
    await refreshDir(dir)
    refreshGit()
    report(`Created ${name}`)
  }).catch(() => undefined) // reported by guarded
}

function entryMenu(path: string, isDir: boolean): (MenuItem | 'sep')[] {
  const target = isDir ? path : parentOf(path)
  return [
    { label: 'New File…', run: () => void createEntry(target, 'file') },
    { label: 'New Folder…', run: () => void createEntry(target, 'folder') },
    'sep',
    { label: 'Cut', run: () => (treeClip = { paths: [path], cut: true }) },
    { label: 'Copy', run: () => (treeClip = { paths: [path], cut: false }) },
    ...(treeClip ? [{ label: `Paste into ${basename(target)}`, run: () => void pasteInto(target) }] : []),
    { label: 'Duplicate…', run: () => void duplicateEntry(path) },
    'sep',
    { label: 'Rename…', run: () => void renameEntry(path) },
    { label: 'Delete', danger: true, run: () => void deleteEntry(path) },
    'sep',
    { label: 'Find in Files…', run: () => findIn(target) },
    { label: 'Open in Terminal', run: () => { showView('terminal'); terminals.newTerminal(target) } },
    'sep',
    { label: 'Copy Path', run: () => void window.forge.copyText(path) },
    { label: 'Copy Relative Path', run: () => void window.forge.copyText(relPath(path)) },
    { label: 'Reveal in File Explorer', run: () => void window.forge.reveal(path) }
  ]
}

// Dropping on empty tree space moves into the project root.
treeEl.ondragover = (ev) => {
  if (rootDir && ev.dataTransfer?.types.includes('text/forge-path')) ev.preventDefault()
}
treeEl.ondrop = (ev) => {
  ev.preventDefault()
  const from = ev.dataTransfer?.getData('text/forge-path')
  if (from && rootDir) void moveEntry(from, rootDir)
}

/** Find in Files, limited to a folder. */
function findIn(dir: string): void {
  showView('find')
  const rel = relPath(dir)
  ;($('find-mask') as HTMLInputElement).value = rel && rel !== dir ? `${rel.split('\\').join('/')}/**` : ''
  findInput.focus()
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
    await window.forge.watchRoot(dir)
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
  const digit = e.altKey && !e.ctrlKey && !e.metaKey ? /^Digit([0123679])$/.exec(e.code)?.[1] : undefined
  if (digit !== undefined) {
    e.preventDefault()
    tw.toggle({ '0': 'commit', '1': 'project', '2': 'output', '3': 'terminal', '6': 'problems', '7': 'structure', '9': 'git' }[digit]!)
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
  if (e.code === 'KeyN' && e.altKey && e.shiftKey) { e.preventDefault(); void openSearch('symbols'); return }
  if (e.code === 'KeyN' && !e.altKey) { e.preventDefault(); void openSearch(e.shiftKey ? 'files' : 'symbols', e.shiftKey ? undefined : { classesOnly: true }); return }
  if (e.code === 'KeyA' && e.shiftKey && !e.altKey) { e.preventDefault(); void openSearch('actions'); return }
  // Templates act on the editor, so only while it has focus (Ctrl+J is a newline in a terminal).
  if (!e.shiftKey && (e.target as Element | null)?.closest?.('.monaco-editor')) {
    if (e.altKey && e.code === 'KeyT') { e.preventDefault(); templates.surround(); return }
    if (!e.altKey && e.code === 'KeyJ') { e.preventDefault(); templates.pickTemplate(); return }
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
  showUsages: (symbol, hits, what = 'usage') => {
    showView('find')
    finder.show(`${hits.length} ${what}${hits.length === 1 ? '' : 's'} of ${symbol || 'symbol'}`, symbol, hits)
  },
  showHierarchy: (root) => hierarchyView.show(root),
  getRoot: () => rootDir,
  openFile,
  report,
  onProblems: (errors, warnings) => {
    stProblems.textContent = errors || warnings ? `✕ ${errors}  ⚠ ${warnings}` : ''
    stProblems.classList.toggle('has-errors', errors > 0)
  }
})

const hierarchyView = initHierarchy({ root: $('view-hierarchy'), openAt: openFile, relPath, reveal: () => showView('hierarchy') })
const structure = initStructure({
  root: $('view-structure'),
  editor,
  getSymbols: (model) => lsp.documentSymbols(model),
  isVisible: () => tw.isOpen('structure')
})
tw.setOnShow('structure', () => void structure.refresh())
initConflicts(editor)
const history = initHistory({
  editor,
  currentPath: () => (active && !active.diff ? active.path : null),
  showDiff: (path, original) => guarded(`Diff ${basename(path)}`, () => showDiffTab(path, original)),
  report
})
editor.addAction({
  id: 'forge.localHistory',
  label: 'Show Local History',
  contextMenuGroupId: 'navigation',
  contextMenuOrder: 2.5,
  run: () => void history.show().catch((err: unknown) => report(`Local history: ${err instanceof Error ? err.message : String(err)}`, true))
})
// ---- Scratch files, Compare with…, notifications ----
const SCRATCH_TYPES: [ext: string, label: string][] = [
  ['ts', 'TypeScript'], ['js', 'JavaScript'], ['py', 'Python'], ['json', 'JSON'], ['md', 'Markdown'], ['txt', 'Plain text'],
  ['html', 'HTML'], ['css', 'CSS'], ['c', 'C'], ['cpp', 'C++'], ['mx', 'Mort'], ['sh', 'Shell script']
]
function newScratch(): void {
  quickPick({
    title: 'New Scratch File',
    placeholder: 'Choose a language',
    items: SCRATCH_TYPES.map(([ext, label]) => ({ label, detail: `.${ext}`, icon: fileIcon(`x.${ext}`), data: ext })),
    onChoose: (ext) => {
      void guarded('New scratch file', async () => openFile(await window.forge.scratchCreate(ext))).catch(() => undefined)
    }
  })
}
async function showScratches(): Promise<void> {
  const list = await window.forge.scratchList()
  quickPick({
    title: 'Scratch Files',
    placeholder: 'Type to filter',
    items: list.map((p) => ({ label: basename(p), detail: 'newest first', icon: fileIcon(basename(p)), data: p })),
    emptyText: 'No scratch files yet — create one with Ctrl+Alt+Shift+Insert',
    onChoose: (p) => void openFile(p).catch(() => undefined) // reported by the opener
  })
}
async function compareWithFile(): Promise<void> {
  const cur = active && !active.diff ? active : null
  const root = rootDir
  if (!cur || !root) return report('Open a file in a project to compare it', true)
  const files = (await window.forge.listFiles(root)).filter((p) => !samePath(p, cur.path))
  quickPick({
    title: `Compare ${basename(cur.path)} with…`,
    placeholder: 'Type a file name',
    items: files.map((p) => ({ label: basename(p), detail: relPath(p), icon: fileIcon(basename(p)), data: p })),
    onChoose: (other) => {
      void guarded(`Compare with ${basename(other)}`, async () => showDiffTab(cur.path, await window.forge.readFile(other))).catch(() => undefined)
    }
  })
}
async function compareWithClipboard(): Promise<void> {
  const cur = active && !active.diff ? active : null
  if (!cur) return report('Open a file to compare it with the clipboard', true)
  const text = await window.forge.readClipboard()
  if (!text) return report('The clipboard has no text', true)
  await guarded('Compare with clipboard', () => showDiffTab(cur.path, text))
}
const bell = $('st-bell')
const drawBell = (): void => {
  const n = notifications.unread()
  bell.innerHTML = icons.bell + (n ? `<span class="bell-count">${n > 99 ? '99+' : n}</span>` : '')
  bell.classList.toggle('has-unread', n > 0)
}
notifications.onChange(drawBell)
drawBell()
function showNotifications(): void {
  const list = notifications.list()
  notifications.markRead()
  quickPick({
    title: 'Notifications',
    placeholder: 'Type to filter',
    items: list.map((n) => ({
      label: n.message,
      detail: new Date(n.time).toLocaleTimeString(),
      icon: `<span class="note-ico ${n.kind}">${n.kind === 'err' ? '!' : '✓'}</span>`,
      data: n.message
    })),
    emptyText: 'No notifications yet',
    onChoose: (msg) => void window.forge.copyText(msg) // choosing one copies its text
  })
}
bell.onclick = showNotifications

const templates = initTemplates(editor)
templates.init()
for (const problem of templateProblems) report(problem, true) // a broken snippets file is never silent
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
  caseBtn: $('find-case'),
  wordBtn: $('find-word'),
  regexBtn: $('find-regex'),
  mask: $<HTMLInputElement>('find-mask'),
  replaceInput: $<HTMLInputElement>('find-replace'),
  replaceBtn: $('find-replace-all'),
  getRoot: () => rootDir,
  relPath,
  openAt: openFile,
  guard: guarded,
  openText: (path) => [...openFiles.values()].find((f) => !f.diff && samePath(f.path, path))?.model.getValue(),
  setOpenText: (path, text) => {
    const m = [...openFiles.values()].find((f) => !f.diff && samePath(f.path, path))?.model
    if (!m) return
    m.pushStackElement()
    m.pushEditOperations([], [{ range: m.getFullModelRange(), text }], () => null)
    m.pushStackElement()
  },
  report
})
tw.setOnShow('find', () => findInput.focus())
// Ctrl+Shift+R is Replace in Files (Monaco would use it for Refactor, which has Ctrl+Alt+Shift+T here).
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR, () => {
  showView('find')
  $('find-replace').focus()
})
const preview = initPreview({
  root: $('view-preview'),
  current: () => {
    const m = active && !active.diff && !active.image && editor.getModel()
    return m && active && m.getLanguageId() === 'markdown' ? { path: active.path, text: m.getValue() } : null
  },
  openFile: (p) => openFile(p),
  isVisible: () => tw.isOpen('preview'),
  report
})
tw.setOnShow('preview', () => void preview.refresh().catch((e: unknown) => report(`Preview: ${String(e)}`, true)))
{
  let timer: number | undefined
  const later = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (tw.isOpen('preview')) void preview.refresh().catch((e: unknown) => report(`Preview: ${String(e)}`, true))
    }, 200)
  }
  editor.onDidChangeModelContent(later)
  editor.onDidChangeModel(later)
}
const httpClient = initHttpClient({
  editor,
  root: $('view-http'),
  isHttpFile: () => !!active && !active.diff && !active.image && /\.(http|rest)$/i.test(active.path),
  reveal: () => showView('http'),
  report
})
const testRunner = initTestRunner({
  editor,
  currentPath: () => (active && !active.diff && !active.image ? active.path : null),
  getRoot: () => rootDir,
  relPath,
  readFile: (p) => window.forge.readFile(p),
  runCommand: (label, cwd, cmd) => runUi.runCommandLine(label, cwd, cmd),
  report
})
const todo = initTodo({
  root: $('view-todo'),
  getRoot: () => rootDir,
  relPath,
  openAt: openFile,
  report,
  onCount: (n) => tw.setBadge('todo', n ? String(n) : '', 'info')
})
tw.setOnShow('todo', () => void todo.refresh().catch((e: unknown) => report(`TODO scan: ${String(e)}`, true)))

// ---- Git ----
const gitKinds = new Map<string, ChangeKind>() // normalized path -> change kind
let gitIgnored: string[] = [] // normalized paths git ignores (a folder covers everything in it)

function decorateTree(): void {
  treeEl.querySelectorAll<HTMLElement>('.node[data-path]').forEach((n) => {
    const p = norm(n.dataset['path'] ?? '').toLowerCase()
    const kind = gitKinds.get(p)
    if (kind) n.dataset['git'] = kind
    else if (gitIgnored.some((i) => p === i || p.startsWith(i + '/'))) n.dataset['git'] = 'ignored'
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
    await showDiffTab(path, original, kind === 'deleted')
  })
}

/** Opens (or refreshes) a diff tab: `original` on the left, the real file (editable) on the right. */
async function showDiffTab(path: string, original: string, deleted = false): Promise<void> {
  const existing = openFiles.get(`diff:${path}`)
  if (existing?.diff) {
    existing.diff.original.setValue(original)
    activate(existing)
    return
  }
  // The diff edits the real file, so the file has to be open; a deleted file has nothing to open.
  let shared: OpenFile | undefined
  if (!deleted) {
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
}

/** A read-only diff of two texts (a file at two commits, say). `label` names the revision in the tab. */
async function showStaticDiff(path: string, label: string, left: string, right: string): Promise<void> {
  const shown = `${path} @ ${label}` // one tab per file and revision
  const existing = openFiles.get(`diff:${shown}`)
  if (existing) {
    activate(existing)
    return
  }
  const uriPath = `/${label}/${norm(path)}` // keeps the file's extension, so it gets the right syntax coloring
  const f: OpenFile = {
    path: shown,
    savedVersion: 0,
    model: monaco.editor.createModel(right, undefined, monaco.Uri.from({ scheme: 'forge-rev', path: uriPath })),
    diff: { original: monaco.editor.createModel(left, undefined, monaco.Uri.from({ scheme: 'forge-rev-old', path: uriPath })) }
  }
  f.savedVersion = f.model.getAlternativeVersionId()
  openFiles.set(tabKey(f), f)
  activate(f)
}

/** After a commit or branch switch: diffs are stale snapshots, and files on disk may have changed. */
async function onWorktreeChanged(): Promise<void> {
  for (const f of [...openFiles.values()]) if (f.diff) closeFile(f)
  for (const f of [...openFiles.values()]) {
    if (isDirty(f)) continue // never clobber unsaved edits
    try {
      const text = await window.forge.readFile(f.path)
      f.savedText = text
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
  openFile: (path) => openFile(path),
  saveAll: saveAllDirty,
  pullMode: () => settings.get<'ff-only' | 'merge' | 'rebase'>('gitPullMode'),
  onIgnored: (paths) => {
    gitIgnored = paths.map((p) => norm(p).toLowerCase())
    decorateTree()
  },
  onStatus: (changes: GitChange[]) => {
    gitKinds.clear()
    for (const c of changes) gitKinds.set(norm(c.path).toLowerCase(), c.kind)
    decorateTree()
    refreshBlame()
    gutter.invalidate() // the committed texts may have changed (commit, checkout, pull)
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

// Git can't show a file that isn't in HEAD (untracked, or the repository has no commits yet): no change marks then.
const NOT_IN_HEAD = /not inside a git repository|exists on disk, but not in|does not exist in|invalid object name|unknown revision|bad revision/i
const gutter = initGutter({
  editor,
  currentPath: () => (active && !active.diff ? active.path : null),
  headText: async (path) => {
    const root = rootDir
    if (!root) return null
    try {
      return await window.forge.gitShow(root, path)
    } catch (err) {
      if (NOT_IN_HEAD.test(err instanceof Error ? err.message : String(err))) return null
      throw err
    }
  },
  openDiff: (path) => void openDiff(path, 'modified').catch(() => undefined), // reported by the opener
  enabled: () => settings.get<boolean>('gitGutter'),
  report
})
settings.onChange((key) => {
  if (key === 'gitGutter') gutter.refresh()
  if (key === 'treeShowHidden' && rootDir) void refreshDir(rootDir).catch((err: unknown) => report(`Refresh tree: ${String(err)}`, true))
})
const annotate = initAnnotate({
  editor,
  getRoot: () => rootDir,
  currentPath: () => (active && !active.diff ? active.path : null),
  isDirty: () => !!active && !active.diff && isDirty(active),
  plainLineNumbers: () => settings.get<string>('lineNumbers') as monaco.editor.LineNumbersType,
  report
})
const toggleAnnotate = (): void =>
  void annotate.toggle().catch((err: unknown) => report(`Annotate: ${err instanceof Error ? err.message : String(err)}`, true))
editor.addAction({ id: 'forge.annotate', label: 'Annotate with Git Blame', contextMenuGroupId: 'navigation', contextMenuOrder: 2.6, run: toggleAnnotate })
const gitLog = initGitLog({
  root: $('view-git'),
  getRoot: () => rootDir,
  report,
  guard: guarded,
  showStaticDiff,
  showDiff: (path, original, deleted) => guarded(`Diff ${basename(path)}`, () => showDiffTab(path, original, deleted)),
  reveal: () => showView('git'),
  onWorktreeChanged,
  refreshStatus: () => gitUi.refresh().catch(() => undefined) // gitUi reports its own failures
})
tw.setOnShow('git', () => void gitLog.refresh().catch(() => undefined)) // reported where it fails
const showBranches = (): void =>
  void gitLog.showBranches().catch((err: unknown) => report(`Git branches: ${err instanceof Error ? err.message : String(err)}`, true))
$('branch-widget').onclick = showBranches
const showFileHistory = (path: string): void =>
  void gitLog.showFileHistory(path).catch((err: unknown) => report(`Git history: ${err instanceof Error ? err.message : String(err)}`, true))

// ---- Run ----
/** Saves every modified file so a run never executes stale code from disk. */
async function saveAllDirty(): Promise<void> {
  for (const f of openFiles.values()) {
    if (f.diff || !isDirty(f)) continue // a diff tab shares its file's model, which is saved via the file tab
    const value = f.model.getValue()
    const version = f.model.getAlternativeVersionId()
    await window.forge.writeFile(f.path, value)
    f.savedText = value
    history.record(f.path, value)
    f.savedVersion = version
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
initBreakpointsWindow({
  root: $('view-breakpoints'),
  api: dbg.breakpoints,
  relPath,
  openAt: openFile,
  onCount: (n) => tw.setBadge('breakpoints', n ? String(n) : '', 'info')
})

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
  openSearchScope: (scope, classesOnly) => void openSearch(scope, classesOnly ? { classesOnly } : undefined),
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
  openSnippetsDir: async () => void (await window.forge.openSnippetsDir()),
  surround: () => templates.surround(),
  newScratch,
  showScratches: () => void showScratches().catch((err: unknown) => report(`Scratch files: ${String(err)}`, true)),
  compareWithFile: () => void compareWithFile().catch((err: unknown) => report(`Compare: ${String(err)}`, true)),
  compareWithClipboard: () => void compareWithClipboard().catch((err: unknown) => report(`Compare: ${String(err)}`, true)),
  showNotifications,
  gitFileHistory: () => {
    if (active && !active.diff) showFileHistory(active.path)
    else report('Open a file to see its git history', true)
  },
  gitBranches: () => showBranches(),
  runTests: () => void testRunner.runFile().catch((err: unknown) => report(`Run tests: ${String(err)}`, true)),
  runHttp: () => void httpClient.runAtCursor().catch((err: unknown) => report(`HTTP: ${String(err)}`, true)),
  findReplace: () => {
    showView('find')
    $('find-replace').focus()
  },
  gitNextChange: () => gutter.next(),
  gitForcePush: () => gitUi.push(true),
  gitAnnotate: toggleAnnotate,
  gitPrevChange: () => gutter.prev(),
  gitFetch: () => {
    const root = rootDir
    if (!root) return report('Open a project first', true)
    void guarded('Fetch', async () => {
      await window.forge.gitFetch(root)
      report('Fetched')
      await gitUi.refresh()
    }).catch(() => undefined)
  },
  showHistory: () => void history.show().catch((err: unknown) => report(`Local history: ${err instanceof Error ? err.message : String(err)}`, true)),
  restoreHistory: () => void history.restore().catch((err: unknown) => report(`Local history: ${err instanceof Error ? err.message : String(err)}`, true)),
  insertTemplate: () => templates.pickTemplate(),
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
