import * as monaco from 'monaco-editor'

// Merge conflicts in the editor. A file git could not merge has blocks like
//
//   <<<<<<< HEAD          <- your side
//   ...
//   =======
//   ...                   <- their side
//   >>>>>>> feature
//
// Each block is highlighted and gets "Accept Yours | Accept Theirs | Accept Both" above it (code lenses).

export interface ConflictBlock {
  /** 1-based line numbers of the marker lines. */
  start: number
  mid: number
  end: number
  /** The line of a `|||||||` base section (diff3 style), if any. */
  base?: number
  yours: string
  theirs: string
  yoursLabel: string
  theirsLabel: string
}

/** Finds the conflict blocks in a text. Incomplete or nested markers are ignored. */
export function parseConflicts(text: string): ConflictBlock[] {
  if (!text.includes('<<<<<<<')) return []
  const lines = text.split(/\r?\n/)
  const blocks: ConflictBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^<<<<<<<( |$)/.test(lines[i] ?? '')) continue
    let base: number | undefined
    let mid = -1
    let end = -1
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? ''
      if (/^<<<<<<<( |$)/.test(l)) break // another block starts: this one is broken
      if (/^\|\|\|\|\|\|\|( |$)/.test(l) && mid < 0) base = j
      else if (/^=======$/.test(l) && mid < 0) mid = j
      else if (/^>>>>>>>( |$)/.test(l) && mid >= 0) {
        end = j
        break
      }
    }
    if (mid < 0 || end < 0) continue
    const yoursEnd = base ?? mid
    blocks.push({
      start: i + 1,
      mid: mid + 1,
      end: end + 1,
      base: base === undefined ? undefined : base + 1,
      yours: lines.slice(i + 1, yoursEnd).join('\n'),
      theirs: lines.slice(mid + 1, end).join('\n'),
      yoursLabel: (lines[i] ?? '').slice(8).trim() || 'yours',
      theirsLabel: (lines[end] ?? '').slice(8).trim() || 'theirs'
    })
    i = end
  }
  return blocks
}

export type Accept = 'yours' | 'theirs' | 'both'

/** The text that replaces a whole block when one side (or both) is accepted. */
export function resolveBlock(b: ConflictBlock, how: Accept): string {
  if (how === 'yours') return b.yours
  if (how === 'theirs') return b.theirs
  return [b.yours, b.theirs].filter((s) => s !== '').join('\n')
}

export interface Conflicts {
  /** Whether the model still has any conflict blocks. */
  has: (model: monaco.editor.ITextModel) => boolean
}

export function initConflicts(editor: monaco.editor.IStandaloneCodeEditor): Conflicts {
  const decorations = editor.createDecorationsCollection()

  function paint(): void {
    const model = editor.getModel()
    if (!model) return decorations.clear()
    const blocks = parseConflicts(model.getValue())
    decorations.set(
      blocks.flatMap((b) => {
        const whole = (from: number, to: number, cls: string): monaco.editor.IModelDeltaDecoration[] =>
          from > to ? [] : [{ range: new monaco.Range(from, 1, to, 1), options: { isWholeLine: true, className: cls } }]
        const yoursEnd = (b.base ?? b.mid) - 1
        return [
          ...whole(b.start, b.start, 'conflict-marker-line'),
          ...whole(b.start + 1, yoursEnd, 'conflict-yours-line'),
          ...(b.base ? whole(b.base, b.mid - 1, 'conflict-base-line') : []),
          ...whole(b.mid, b.mid, 'conflict-marker-line'),
          ...whole(b.mid + 1, b.end - 1, 'conflict-theirs-line'),
          ...whole(b.end, b.end, 'conflict-marker-line')
        ]
      })
    )
  }
  let timer: number | undefined
  const later = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(paint, 120)
  }
  editor.onDidChangeModel(paint)
  editor.onDidChangeModelContent(later)

  monaco.editor.registerCommand('forge.conflict.accept', (_accessor, uri: string, startLine: number, how: Accept) => {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri))
    if (!model) return
    const b = parseConflicts(model.getValue()).find((x) => x.start === startLine)
    if (!b) return // the block changed or was already resolved
    model.pushStackElement()
    model.pushEditOperations(
      [],
      [{ range: new monaco.Range(b.start, 1, b.end, model.getLineMaxColumn(b.end)), text: resolveBlock(b, how) }],
      () => null
    )
    model.pushStackElement()
  })

  monaco.languages.registerCodeLensProvider('*', {
    provideCodeLenses(model) {
      const blocks = parseConflicts(model.getValue())
      const uri = model.uri.toString()
      const lens = (b: ConflictBlock, how: Accept, title: string): monaco.languages.CodeLens => ({
        range: new monaco.Range(b.start, 1, b.start, 1),
        command: { id: 'forge.conflict.accept', title, arguments: [uri, b.start, how] }
      })
      return {
        lenses: blocks.flatMap((b) => [
          lens(b, 'yours', `Accept Yours (${b.yoursLabel})`),
          lens(b, 'theirs', `Accept Theirs (${b.theirsLabel})`),
          lens(b, 'both', 'Accept Both')
        ]),
        dispose: () => undefined
      }
    }
  })

  return { has: (model) => parseConflicts(model.getValue()).length > 0 }
}
