import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { DARCULA, defineDarcula } from './darcula'

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

function report(msg: string, isError = false): void {
  statusMsg.textContent = msg
  statusEl.classList.toggle('error', isError)
  if (isError) console.error(msg)
}

async function guarded<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    report(`${label}: ${err instanceof Error ? err.message : String(err)}`, true)
    throw err
  }
}

const basename = (p: string): string => p.split(/[\/]/).pop() ?? p
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
    await renderDir(dir, treeEl)
    document.title = `${basename(dir)} – Forge`
  })
}

editor.onDidChangeCursorPosition((e) => {
  statusPos.textContent = `${e.position.lineNumber}:${e.position.column}`
})

window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return
  if (e.key === 'o') { e.preventDefault(); void openFolder() }
  else if (e.key === 's') { e.preventDefault(); void saveActive() }
  else if (e.key === 'w' && active) { e.preventDefault(); closeFile(active) }
})

renderTabs()
