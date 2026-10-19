import * as monaco from 'monaco-editor'

// Annotate with Git Blame: shows who last changed each line (author and date) in the line-number column.
// It reads git's blame of the saved file, so it only makes sense while the file has no unsaved edits.

export interface AnnotateDeps {
  editor: monaco.editor.IStandaloneCodeEditor
  getRoot: () => string | null
  currentPath: () => string | null
  /** Whether the file in the editor has unsaved edits. */
  isDirty: () => boolean
  /** What to set the line numbers back to when the annotations go away. */
  plainLineNumbers: () => monaco.editor.LineNumbersType
  report: (msg: string, isError?: boolean) => void
}

export interface Annotate {
  toggle: () => Promise<void>
  isOn: () => boolean
  /** Turns the annotations off (another file was opened, the file was edited...). */
  off: () => void
}

const pad = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))

export function initAnnotate(deps: AnnotateDeps): Annotate {
  let on = false

  function off(): void {
    if (!on) return
    on = false
    deps.editor.updateOptions({ lineNumbers: deps.plainLineNumbers(), lineNumbersMinChars: 5 })
  }

  // Annotations belong to one file's saved text: leaving the file or editing it makes them wrong.
  deps.editor.onDidChangeModel(off)
  deps.editor.onDidChangeModelContent(() => {
    if (on && deps.isDirty()) off()
  })

  return {
    isOn: () => on,
    off,
    async toggle() {
      if (on) return off()
      const root = deps.getRoot()
      const path = deps.currentPath()
      if (!root || !path) return deps.report('Open a file in a git project to annotate it', true)
      if (deps.isDirty()) return deps.report('Save the file first: blame reads the saved version', true)
      const lines = await window.forge.gitBlame(root, path)
      if (!lines) return deps.report('Git does not track this file yet, so there is nothing to annotate', true)
      on = true
      deps.editor.updateOptions({
        lineNumbersMinChars: 30,
        lineNumbers: (n) => {
          const b = lines[n - 1]
          if (!b) return `${pad('Not committed', 22)} ${n}`
          if (/^0+$/.test(b.sha)) return `${pad('Not committed yet', 22)} ${n}`
          const d = new Date(b.time * 1000)
          const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          return `${pad(b.author, 12)} ${date} ${n}`
        }
      })
    }
  }
}
