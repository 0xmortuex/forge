import * as monaco from 'monaco-editor'
import { quickPick } from './quick'

// Local History in the UI: pick an earlier version of the current file to compare with it, or to restore.

export interface HistoryDeps {
  editor: monaco.editor.IStandaloneCodeEditor
  /** The file in the editor, or null. */
  currentPath: () => string | null
  /** Opens a diff tab: `original` on the left, the real file (editable) on the right. */
  showDiff: (path: string, original: string) => Promise<void>
  report: (msg: string, isError?: boolean) => void
}

export interface History {
  /** Records the file's text (call after opening or saving it). */
  record: (path: string, text: string) => void
  /** Pick a version and compare it with the file. */
  show: () => Promise<void>
  /** Pick a version and put it into the editor (undoable). */
  restore: () => Promise<void>
}

const SIZE = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** "3 minutes ago", "2 hours ago", "yesterday", or the date. */
export function ago(time: number, now = Date.now()): string {
  const s = Math.round((now - time) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d} days ago`
  return new Date(time).toLocaleDateString()
}

export function initHistory(deps: HistoryDeps): History {
  const record: History['record'] = (path, text) => {
    window.forge.historyAdd(path, text).catch((err: unknown) => deps.report(`Local history: ${err instanceof Error ? err.message : String(err)}`, true))
  }

  async function pick(title: string, onChoose: (path: string, text: string) => void): Promise<void> {
    const path = deps.currentPath()
    if (!path) return deps.report('Open a file to see its history', true)
    const list = await window.forge.historyList(path)
    quickPick({
      title,
      placeholder: 'Type to filter versions',
      emptyText: 'No earlier versions yet. Forge keeps one each time you open or save the file.',
      items: list.map((s, i) => ({
        label: ago(s.time),
        detail: `${new Date(s.time).toLocaleString()} · ${SIZE(s.size)}${i === 0 ? ' · latest' : ''}`,
        data: s.id
      })),
      onChoose: (id) => {
        window.forge
          .historyRead(path, id)
          .then((text) => onChoose(path, text))
          .catch((err: unknown) => deps.report(`Local history: ${err instanceof Error ? err.message : String(err)}`, true))
      }
    })
  }

  return {
    record,
    show: () => pick('Local History — compare with…', (path, text) => void deps.showDiff(path, text).catch(() => undefined)), // reported by the opener
    restore: () =>
      pick('Local History — restore…', (_path, text) => {
        const model = deps.editor.getModel()
        if (!model) return
        // An edit operation (not setValue), kept as an undo step of its own, so Ctrl+Z brings the current text back.
        model.pushStackElement()
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
        model.pushStackElement()
        deps.report('Restored an earlier version (Ctrl+Z undoes it)')
      })
  }
}
