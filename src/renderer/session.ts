import { userData } from './settings'

// What Forge remembers between launches (separate from settings, which are choices): the open project,
// recent projects, open tabs and window layout. Stored in state.json in the user-data folder.

export interface Layout {
  projectWidth?: number
  bottomHeight?: number
  projectHidden?: boolean
  bottomHidden?: boolean
  rightWidth?: number
  rightHidden?: boolean
  side?: string // the window the left dock was showing
  view?: string // the window the bottom dock was showing
  /** Which dock each tool window is in, and which window each dock was showing. */
  docks?: Record<string, string>
  active?: { left?: string; right?: string; bottom?: string }
}

export interface SessionState {
  lastFolder?: string
  recents: string[]
  openFiles: string[]
  activeFile?: string
  /** Most recently opened files first (Recent Files). */
  recentFiles?: string[]
  bookmarks?: { path: string; line: number }[]
  /** Debugger breakpoints (with their conditions) and watch expressions. */
  breakpoints?: { path: string; line: number; condition?: string; logMessage?: string; disabled?: boolean }[]
  watches?: string[]
  layout: Layout
}

const MAX_RECENTS = 8
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function record(v: unknown): Record<string, string> | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val
  return out
}

function bookmarkList(v: unknown): { path: string; line: number }[] {
  if (!Array.isArray(v)) return []
  const out: { path: string; line: number }[] = []
  for (const b of v) {
    const o = b as { path?: unknown; line?: unknown }
    if (typeof o?.path === 'string' && typeof o.line === 'number' && o.line > 0) out.push({ path: o.path, line: o.line })
  }
  return out
}

function breakpointList(v: unknown): NonNullable<SessionState['breakpoints']> {
  if (!Array.isArray(v)) return []
  const out: NonNullable<SessionState['breakpoints']> = []
  for (const b of v) {
    const o = b as Record<string, unknown>
    if (typeof o?.['path'] !== 'string' || typeof o['line'] !== 'number' || o['line'] < 1) continue
    out.push({
      path: o['path'],
      line: o['line'],
      condition: typeof o['condition'] === 'string' ? o['condition'] : undefined,
      logMessage: typeof o['logMessage'] === 'string' ? o['logMessage'] : undefined,
      disabled: o['disabled'] === true ? true : undefined
    })
  }
  return out
}

function load(raw: Record<string, unknown>): SessionState {
  const layout = (typeof raw['layout'] === 'object' && raw['layout'] !== null ? raw['layout'] : {}) as Record<string, unknown>
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)
  return {
    lastFolder: typeof raw['lastFolder'] === 'string' ? raw['lastFolder'] : undefined,
    recents: strings(raw['recents']).slice(0, MAX_RECENTS),
    openFiles: strings(raw['openFiles']),
    activeFile: typeof raw['activeFile'] === 'string' ? raw['activeFile'] : undefined,
    recentFiles: strings(raw['recentFiles']),
    bookmarks: bookmarkList(raw['bookmarks']),
    breakpoints: breakpointList(raw['breakpoints']),
    watches: strings(raw['watches']),
    layout: {
      projectWidth: num(layout['projectWidth']),
      bottomHeight: num(layout['bottomHeight']),
      projectHidden: layout['projectHidden'] === true,
      bottomHidden: layout['bottomHidden'] === true,
      rightWidth: num(layout['rightWidth']),
      rightHidden: layout['rightHidden'] !== false, // the right dock starts closed
      side: str(layout['side']),
      view: str(layout['view']),
      docks: record(layout['docks']),
      active: (() => {
        const a = (typeof layout['active'] === 'object' && layout['active'] !== null ? layout['active'] : {}) as Record<string, unknown>
        return { left: str(a['left']), right: str(a['right']), bottom: str(a['bottom']) }
      })()
    }
  }
}

let state = load(userData.state)
let timer: number | undefined

export const session = {
  get: (): SessionState => state,
  /** Called when saving fails; the app wires this to its error reporting. */
  onError: (err: Error): void => console.error(err),
  update(patch: Partial<SessionState>): void {
    state = { ...state, ...patch }
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      window.forge.stateSave(JSON.stringify(state, null, 2)).catch((err: unknown) => session.onError(err as Error))
    }, 300)
  },
  /** Writes any pending change right now (the window is closing). */
  flush(): Promise<void> {
    if (timer === undefined) return Promise.resolve()
    window.clearTimeout(timer)
    timer = undefined
    return window.forge.stateSave(JSON.stringify(state, null, 2))
  },
  addRecent(folder: string): void {
    const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase() // Windows paths ignore case
    this.update({ recents: [folder, ...state.recents.filter((r) => !same(r, folder))].slice(0, MAX_RECENTS) })
  },
  removeRecent(folder: string): void {
    this.update({ recents: state.recents.filter((r) => r !== folder), lastFolder: state.lastFolder === folder ? undefined : state.lastFolder })
  }
}
