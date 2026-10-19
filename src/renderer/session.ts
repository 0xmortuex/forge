import { userData } from './settings'

// What Forge remembers between launches (separate from settings, which are choices): the open project,
// recent projects, open tabs and window layout. Stored in state.json in the user-data folder.

export interface Layout {
  projectWidth?: number
  bottomHeight?: number
  projectHidden?: boolean
  bottomHidden?: boolean
  side?: 'project' | 'commit'
  view?: string
}

export interface SessionState {
  lastFolder?: string
  recents: string[]
  openFiles: string[]
  activeFile?: string
  layout: Layout
}

const MAX_RECENTS = 8
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function load(raw: Record<string, unknown>): SessionState {
  const layout = (typeof raw['layout'] === 'object' && raw['layout'] !== null ? raw['layout'] : {}) as Record<string, unknown>
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)
  return {
    lastFolder: typeof raw['lastFolder'] === 'string' ? raw['lastFolder'] : undefined,
    recents: strings(raw['recents']).slice(0, MAX_RECENTS),
    openFiles: strings(raw['openFiles']),
    activeFile: typeof raw['activeFile'] === 'string' ? raw['activeFile'] : undefined,
    layout: {
      projectWidth: num(layout['projectWidth']),
      bottomHeight: num(layout['bottomHeight']),
      projectHidden: layout['projectHidden'] === true,
      bottomHidden: layout['bottomHidden'] === true,
      side: layout['side'] === 'commit' ? 'commit' : 'project',
      view: typeof layout['view'] === 'string' ? layout['view'] : undefined
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
