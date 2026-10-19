import * as monaco from 'monaco-editor'
import { fileIcon } from './icons'
import { quickPick } from './quick'
import { session } from './session'

// Where you have been: Back / Forward through locations, Recent Files (Ctrl+E) and Recent Locations (Ctrl+Shift+E).
//
// The history is a list of places plus the index of the current one. Moving the cursor a few lines just updates the
// current place; jumping far (or to another file) adds a new one after it, so Back returns to where you jumped from.

export interface Loc {
  path: string
  line: number
  column: number
}

export interface NavDeps {
  editor: monaco.editor.IStandaloneCodeEditor
  /** The file the editor shows, or null (welcome screen, a diff tab). */
  currentPath: () => string | null
  openAt: (path: string, line: number, column: number) => Promise<void>
  relPath: (path: string) => string
  /** The text of a line, if that file is open (shown in Recent Locations). */
  lineText: (path: string, line: number) => string | undefined
  getRoot: () => string | null
  /** Called when Back/Forward availability may have changed. */
  onChange: () => void
}

export interface Navigation {
  back: () => Promise<void>
  forward: () => Promise<void>
  canBack: () => boolean
  canForward: () => boolean
  /** Call after the active file changed. */
  visit: () => void
  recentFiles: () => void
  recentLocations: () => void
}

const JUMP = 10 // lines: a smaller cursor move is the same place
const MAX_PLACES = 100
const MAX_RECENT = 40

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function initNavigation(deps: NavDeps): Navigation {
  const places: Loc[] = []
  let index = -1
  let going = false // true while Back/Forward itself moves the cursor, which must not be recorded

  const here = (): Loc | null => {
    const path = deps.currentPath()
    const pos = deps.editor.getPosition()
    return path && pos ? { path, line: pos.lineNumber, column: pos.column } : null
  }

  function record(): void {
    const loc = here()
    if (!loc || going) return
    const cur = places[index]
    if (cur && same(cur.path, loc.path) && Math.abs(cur.line - loc.line) <= JUMP) {
      places[index] = loc // still the same place
    } else {
      places.splice(index + 1) // anything "forward" of here is gone
      places.push(loc)
      if (places.length > MAX_PLACES) places.shift()
      index = places.length - 1
    }
    deps.onChange()
  }

  function touchRecent(path: string): void {
    const list = [path, ...(session.get().recentFiles ?? []).filter((p) => !same(p, path))].slice(0, MAX_RECENT)
    session.update({ recentFiles: list })
  }

  async function go(delta: number): Promise<void> {
    const i = index + delta
    const loc = places[i]
    if (!loc) return
    index = i
    going = true
    try {
      await deps.openAt(loc.path, loc.line, loc.column)
    } finally {
      going = false
      deps.onChange()
    }
  }

  deps.editor.onDidChangeCursorPosition(record)

  const fileItem = (path: string, line?: number): { label: string; detail: string; icon: string; data: Loc } => {
    const rel = deps.relPath(path)
    const dir = rel.slice(0, Math.max(0, rel.length - basename(rel).length - 1))
    return { label: basename(path), detail: line ? `${rel}:${line}` : dir, icon: fileIcon(basename(path)), data: { path, line: line ?? 0, column: 1 } } // line 0: open the file without moving its cursor
  }

  return {
    back: () => go(-1),
    forward: () => go(1),
    canBack: () => index > 0,
    canForward: () => index >= 0 && index < places.length - 1,
    visit() {
      const path = deps.currentPath()
      if (path) touchRecent(path)
      record()
    },
    recentFiles() {
      const root = deps.getRoot()
      const list = (session.get().recentFiles ?? []).filter((p) => !root || p.toLowerCase().startsWith(root.toLowerCase()))
      const cur = deps.currentPath()
      quickPick({
        title: 'Recent Files',
        placeholder: 'Type to filter recent files',
        items: list.map((p) => fileItem(p)),
        emptyText: 'No recent files yet',
        // Like JetBrains: the file you were in before this one is pre-selected, so Ctrl+E, Enter toggles between two files.
        selected: cur && list[0] && same(list[0], cur) ? 1 : 0,
        onChoose: (loc) => void deps.openAt(loc.path, loc.line, loc.column).catch(() => undefined) // reported by the opener
      })
    },
    recentLocations() {
      const items = [...places].reverse().map((l) => {
        const text = deps.lineText(l.path, l.line)?.trim()
        const base = fileItem(l.path, l.line)
        return { ...base, label: text || base.label, data: l }
      })
      quickPick({
        title: 'Recent Locations',
        placeholder: 'Type to filter locations',
        items,
        emptyText: 'No locations yet',
        selected: items.length > 1 ? 1 : 0,
        onChoose: (loc) => void deps.openAt(loc.path, loc.line, loc.column).catch(() => undefined)
      })
    }
  }
}
