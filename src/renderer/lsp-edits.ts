import * as monaco from 'monaco-editor'
import type { TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'

/**
 * Applies LSP text edits to a string (for files that aren't open in an editor).
 * Positions are line/character; characters past a line's end clamp to it, and a "\r\n" counts as one break.
 */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  const lineEnd = (line: number): number => {
    const next = starts[line + 1]
    if (next === undefined) return text.length
    return text[next - 2] === '\r' ? next - 2 : next - 1
  }
  const offsetOf = (p: { line: number; character: number }): number =>
    p.line >= starts.length ? text.length : Math.min((starts[p.line] as number) + p.character, lineEnd(p.line))
  // Apply back to front so earlier offsets stay valid. Servers promise the edits don't overlap.
  const ops = edits
    .map((e) => ({ from: offsetOf(e.range.start), to: offsetOf(e.range.end), text: e.newText }))
    .sort((a, b) => b.from - a.from || b.to - a.to)
  let out = text
  for (const op of ops) out = out.slice(0, op.from) + op.text + out.slice(op.to)
  return out
}

/** Flattens a WorkspaceEdit to uri -> edits. File create/rename/delete operations are refused, not skipped. */
export function editsByUri(edit: WorkspaceEdit): Map<string, TextEdit[]> {
  const out = new Map<string, TextEdit[]>()
  const add = (uri: string, edits: TextEdit[]): void => void out.set(uri, [...(out.get(uri) ?? []), ...edits])
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits)
  for (const change of edit.documentChanges ?? []) {
    if ('textDocument' in change) add(change.textDocument.uri, change.edits as TextEdit[])
    else throw new Error(`The language server asked to ${change.kind} a file, which Forge doesn't support yet`)
  }
  return out
}

export interface EditSummary {
  files: number
  edits: number
}

export interface EditDeps {
  /** The open model for a path, if the file is open in a tab. */
  getModel: (path: string) => monaco.editor.ITextModel | undefined
}

/**
 * Applies a server's WorkspaceEdit. Open files are edited in place (one undo step, left unsaved so the user
 * stays in control); closed files are rewritten on disk.
 */
export async function applyWorkspaceEdit(edit: WorkspaceEdit, deps: EditDeps): Promise<EditSummary> {
  const byUri = editsByUri(edit)
  let edits = 0
  for (const [uri, list] of byUri) {
    const path = monaco.Uri.parse(uri).fsPath
    const model = deps.getModel(path)
    if (model) {
      model.pushStackElement()
      model.pushEditOperations(
        [],
        list.map((e) => ({
          range: new monaco.Range(e.range.start.line + 1, e.range.start.character + 1, e.range.end.line + 1, e.range.end.character + 1),
          text: e.newText
        })),
        () => null
      )
      model.pushStackElement()
    } else {
      await window.forge.writeFile(path, applyTextEdits(await window.forge.readFile(path), list))
    }
    edits += list.length
  }
  return { files: byUri.size, edits }
}
