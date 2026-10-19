import * as monaco from 'monaco-editor'
import { fileIcon } from './icons'
import { quickPick } from './quick'
import { session } from './session'

// Bookmarks: a starred line you can come back to. Toggle with Ctrl+F11; Shift+F11 lists them; the Bookmarks window
// shows them too. While a file is open its bookmarks live in the text (as decorations), so they follow the line when
// code is inserted or removed above; the line numbers are written back when the file closes or the session is saved.

export interface Bookmark {
  path: string
  line: number
}

export interface BookmarkDeps {
  editor: monaco.editor.IStandaloneCodeEditor
  /** The window's own root element. */
  root: HTMLElement
  currentPath: () => string | null
  /** The open model for a path, if any. */
  getModel: (path: string) => monaco.editor.ITextModel | undefined
  openAt: (path: string, line: number, column: number) => Promise<void>
  relPath: (path: string) => string
  getRoot: () => string | null
  /** Told the number of bookmarks (for a badge). */
  onCount: (n: number) => void
}

export interface Bookmarks {
  toggle: () => void
  list: () => void
  /** Call when a file's model is created: restores its stars. */
  onModelOpened: (model: monaco.editor.ITextModel, path: string) => void
  /** Call just before a model is disposed: keeps its bookmarks' current lines. */
  onModelClosing: (model: monaco.editor.ITextModel) => void
  /** Writes current line numbers into the saved session (window closing). */
  snapshot: () => void
  /** Redraws the Bookmarks window (the project changed). */
  refresh: () => void
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

interface Mark {
  path: string
  line: number // while the file is closed; once open, `id` (a decoration) is the truth
  id?: string
  model?: monaco.editor.ITextModel
}

export function initBookmarks(deps: BookmarkDeps): Bookmarks {
  const marks: Mark[] = (session.get().bookmarks ?? []).map((b) => ({ path: b.path, line: b.line }))

  const lineOf = (m: Mark): number => (m.id && m.model ? (m.model.getDecorationRange(m.id)?.startLineNumber ?? m.line) : m.line)

  function attach(m: Mark, model: monaco.editor.ITextModel): void {
    const line = Math.min(Math.max(1, m.line), model.getLineCount())
    const [id] = model.deltaDecorations([], [
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: 'bookmark-glyph',
          glyphMarginHoverMessage: { value: 'Bookmark' },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      }
    ])
    m.id = id
    m.model = model
    m.line = line
  }

  function detach(m: Mark): void {
    if (m.id && m.model && !m.model.isDisposed()) {
      m.line = lineOf(m)
      m.model.deltaDecorations([m.id], [])
    }
    m.id = undefined
    m.model = undefined
  }

  const root = deps.root
  const bar = document.createElement('div')
  bar.className = 'tool-bar'
  const title = document.createElement('span')
  title.className = 'tool-title'
  title.textContent = 'Bookmarks'
  bar.append(title)
  const listEl = document.createElement('div')
  listEl.className = 'tool-list'
  root.replaceChildren(bar, listEl)

  function draw(): void {
    const projectRoot = deps.getRoot()
    const mine = marks.filter((m) => !projectRoot || m.path.toLowerCase().startsWith(projectRoot.toLowerCase()))
    deps.onCount(mine.length)
    listEl.replaceChildren()
    if (!mine.length) {
      const hint = document.createElement('div')
      hint.className = 'hint'
      hint.textContent = 'No bookmarks. Press Ctrl+F11 on a line to add one.'
      listEl.append(hint)
      return
    }
    const sorted = [...mine].sort((a, b) => a.path.localeCompare(b.path) || lineOf(a) - lineOf(b))
    for (const m of sorted) {
      const line = lineOf(m)
      const row = document.createElement('div')
      row.className = 'bm'
      row.dataset['line'] = String(line)
      row.insertAdjacentHTML('beforeend', fileIcon(basename(m.path)))
      const name = document.createElement('span')
      name.className = 'bm-name'
      name.textContent = `${basename(m.path)}:${line}`
      const text = document.createElement('span')
      text.className = 'bm-text'
      text.textContent = m.model && !m.model.isDisposed() ? m.model.getLineContent(line).trim() : deps.relPath(m.path)
      const remove = document.createElement('button')
      remove.className = 'icon-btn small'
      remove.title = 'Remove bookmark'
      remove.textContent = '✕'
      remove.onclick = (e) => {
        e.stopPropagation()
        removeMark(m)
      }
      row.append(name, text, remove)
      row.onclick = () => void deps.openAt(m.path, line, 1).catch(() => undefined) // reported by the opener
      listEl.append(row)
    }
  }

  function persist(): void {
    session.update({ bookmarks: marks.map((m) => ({ path: m.path, line: lineOf(m) })) })
  }

  function removeMark(m: Mark): void {
    detach(m)
    marks.splice(marks.indexOf(m), 1)
    persist()
    draw()
  }

  deps.editor.onDidChangeModelContent(() => draw()) // text next to a star may have changed

  return {
    toggle() {
      const path = deps.currentPath()
      const model = deps.editor.getModel()
      const pos = deps.editor.getPosition()
      if (!path || !model || !pos) return
      const existing = marks.find((m) => same(m.path, path) && lineOf(m) === pos.lineNumber)
      if (existing) removeMark(existing)
      else {
        const m: Mark = { path, line: pos.lineNumber }
        attach(m, model)
        marks.push(m)
        persist()
        draw()
      }
    },
    list() {
      const projectRoot = deps.getRoot()
      const items = marks
        .filter((m) => !projectRoot || m.path.toLowerCase().startsWith(projectRoot.toLowerCase()))
        .sort((a, b) => a.path.localeCompare(b.path) || lineOf(a) - lineOf(b))
        .map((m) => {
          const line = lineOf(m)
          const text = m.model && !m.model.isDisposed() ? m.model.getLineContent(line).trim() : ''
          return { label: text || `${basename(m.path)}:${line}`, detail: `${deps.relPath(m.path)}:${line}`, icon: fileIcon(basename(m.path)), data: { path: m.path, line } }
        })
      quickPick({
        title: 'Bookmarks',
        placeholder: 'Type to filter bookmarks',
        items,
        emptyText: 'No bookmarks. Press Ctrl+F11 on a line to add one.',
        onChoose: (b) => void deps.openAt(b.path, b.line, 1).catch(() => undefined)
      })
    },
    onModelOpened(model, path) {
      for (const m of marks) if (same(m.path, path) && !m.id) attach(m, model)
      draw()
    },
    onModelClosing(model) {
      for (const m of marks) if (m.model === model) detach(m)
      persist()
      draw()
    },
    snapshot: persist,
    refresh: draw
  }
}
