import * as monaco from 'monaco-editor'
import { diffArrays } from 'diff'
import { showMenu } from './menu'

// Change markers in the editor gutter, like JetBrains: a green bar beside lines added since the last commit, a blue
// one beside modified lines, a red wedge where lines were removed. Click a bar for the old text and to roll the
// change back. Next/Previous Change jumps between them.

export interface Hunk {
  kind: 'added' | 'modified' | 'removed'
  /** First line in the current text (1-based). For `removed`: the line that now follows the removed text. */
  start: number
  /** Lines in the current text (0 for `removed`). */
  count: number
  /** The text the hunk replaced (empty for `added`). */
  oldLines: string[]
}

/** The changes that turn `before` into `after`, both as arrays of lines. */
export function hunksOf(before: string[], after: string[]): Hunk[] {
  const hunks: Hunk[] = []
  const changes = diffArrays(before, after)
  let line = 1 // current position in `after`
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]!
    if (!c.added && !c.removed) {
      line += c.count ?? c.value.length
    } else if (c.removed) {
      const next = changes[i + 1]
      if (next?.added) {
        hunks.push({ kind: 'modified', start: line, count: next.count ?? next.value.length, oldLines: c.value })
        line += next.count ?? next.value.length
        i++
      } else hunks.push({ kind: 'removed', start: line, count: 0, oldLines: c.value })
    } else {
      hunks.push({ kind: 'added', start: line, count: c.count ?? c.value.length, oldLines: [] })
      line += c.count ?? c.value.length
    }
  }
  return hunks
}

export interface GutterDeps {
  editor: monaco.editor.IStandaloneCodeEditor
  /** The file in the editor, or null (welcome screen, a diff tab). */
  currentPath: () => string | null
  /** The file as of the last commit; null when git does not track it. */
  headText: (path: string) => Promise<string | null>
  openDiff: (path: string) => void
  enabled: () => boolean
  report: (msg: string, isError?: boolean) => void
}

export interface Gutter {
  /** Recompute for the file in the editor. */
  refresh: () => void
  /** The commit or branch changed: forget the remembered committed texts. */
  invalidate: () => void
  next: () => void
  prev: () => void
  /** For tests: the hunks currently shown. */
  hunks: () => Hunk[]
}

const splitLines = (text: string): string[] => {
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop() // the trailing newline is not a line of its own
  return lines
}

export function initGutter(deps: GutterDeps): Gutter {
  const { editor } = deps
  const decorations = editor.createDecorationsCollection()
  const cache = new Map<string, string | null>()
  let shown: Hunk[] = []
  let seq = 0
  let timer: number | undefined

  async function compute(): Promise<void> {
    const mine = ++seq
    const path = deps.currentPath()
    const model = editor.getModel()
    if (!path || !model || !deps.enabled()) {
      shown = []
      decorations.clear()
      return
    }
    const key = path.toLowerCase()
    let head = cache.get(key)
    if (head === undefined) {
      try {
        head = await deps.headText(path)
      } catch (err) {
        deps.report(`Git changes: ${err instanceof Error ? err.message : String(err)}`, true)
        throw err
      }
      cache.set(key, head)
    }
    if (mine !== seq || deps.currentPath() !== path) return
    if (head === null) {
      shown = []
      decorations.clear()
      return
    }
    apply(model, head)
  }

  /** Works out the changes of the text in `model` against `head` and draws their marks. */
  function apply(model: monaco.editor.ITextModel, head: string): void {
    shown = hunksOf(splitLines(head), splitLines(model.getValue()))
    const last = model.getLineCount()
    decorations.set(
      shown.map((h) => {
        const from = Math.min(h.start, last)
        const to = h.kind === 'removed' ? from : Math.min(h.start + h.count - 1, last)
        return {
          range: new monaco.Range(from, 1, to, 1),
          options: { isWholeLine: true, linesDecorationsClassName: `git-gutter git-gutter-${h.kind}` }
        }
      })
    )
  }

  /** If an edit is still waiting for its marks to be redrawn, redraw them now (before they are acted on). */
  function flush(): void {
    if (timer === undefined) return
    window.clearTimeout(timer)
    timer = undefined
    const path = deps.currentPath()
    const model = editor.getModel()
    const head = path ? cache.get(path.toLowerCase()) : undefined
    if (path && model && typeof head === 'string' && deps.enabled()) apply(model, head)
  }

  const run = (): void => void compute().catch(() => undefined) // reported inside
  const later = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      run()
    }, 250)
  }
  editor.onDidChangeModel(run)
  editor.onDidChangeModelContent(later)

  const hunkAt = (line: number): Hunk | undefined =>
    shown.find((h) => (h.kind === 'removed' ? line === Math.min(h.start, editor.getModel()?.getLineCount() ?? line) : line >= h.start && line < h.start + h.count))

  function rollback(h: Hunk): void {
    const model = editor.getModel()
    if (!model) return
    const eol = model.getEOL()
    const old = h.oldLines.join(eol)
    model.pushStackElement()
    if (h.kind === 'added') {
      // Delete the lines, including their line break (or the one before, at the end of the file).
      const end = h.start + h.count
      const range = end <= model.getLineCount() ? new monaco.Range(h.start, 1, end, 1) : new monaco.Range(Math.max(1, h.start - 1), model.getLineMaxColumn(Math.max(1, h.start - 1)), model.getLineCount(), model.getLineMaxColumn(model.getLineCount()))
      model.pushEditOperations([], [{ range, text: '' }], () => null)
    } else if (h.kind === 'removed') {
      const at = Math.min(h.start, model.getLineCount() + 1)
      const range = at > model.getLineCount() ? new monaco.Range(at - 1, model.getLineMaxColumn(at - 1), at - 1, model.getLineMaxColumn(at - 1)) : new monaco.Range(at, 1, at, 1)
      model.pushEditOperations([], [{ range, text: at > model.getLineCount() ? eol + old : old + eol }], () => null)
    } else {
      const end = h.start + h.count - 1
      model.pushEditOperations([], [{ range: new monaco.Range(h.start, 1, end, model.getLineMaxColumn(end)), text: old }], () => null)
    }
    model.pushStackElement()
  }

  // On mouse *up*: opening the menu on mouse down would be undone by the window's "press outside closes menus" handler.
  editor.onMouseUp((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS || !e.target.position) return
    flush() // the marks may be a moment behind the text; act on what is really there
    const h = hunkAt(e.target.position.lineNumber)
    const path = deps.currentPath()
    if (!h || !path) return
    const old = h.oldLines.join('\n')
    showMenu(e.event.posx, e.event.posy, [
      { label: 'Show Diff', run: () => deps.openDiff(path) },
      { label: h.kind === 'added' ? 'Rollback: remove these lines' : 'Rollback Changes', danger: true, run: () => rollback(h) },
      ...(old ? [{ label: 'Copy Old Text', run: () => void window.forge.copyText(old) }] : [])
    ])
  })

  function jump(delta: 1 | -1): void {
    const pos = editor.getPosition()
    if (!pos || !shown.length) return
    const sorted = [...shown].sort((a, b) => a.start - b.start)
    const target =
      delta === 1
        ? (sorted.find((h) => h.start > pos.lineNumber) ?? sorted[0])
        : ([...sorted].reverse().find((h) => h.start < pos.lineNumber) ?? sorted[sorted.length - 1])
    if (!target) return
    const line = Math.min(target.start, editor.getModel()?.getLineCount() ?? target.start)
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.revealLineInCenterIfOutsideViewport(line)
  }

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.DownArrow, () => jump(1))
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.UpArrow, () => jump(-1))

  return {
    refresh: run,
    invalidate() {
      cache.clear()
      run()
    },
    next: () => jump(1),
    prev: () => jump(-1),
    hunks: () => shown
  }
}
