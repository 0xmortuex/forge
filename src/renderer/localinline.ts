import * as monaco from 'monaco-editor'
import { aiConfigured } from './ai'
import { fileIndex, indexedFiles } from './rpc'
import { settings } from './settings'

// Ghost text that finishes the line you are typing, from a small language model trained on this project's own files, on this
// computer (see main/platform/ngram.ts): nothing is sent anywhere, and it stays silent unless the model is sure. Tab accepts.
// Off unless "Finish the line from your project" is switched on in Settings. When the AI suggestions are on and set up they
// take its place, so two providers never fight over the same ghost text.

export interface LocalInlineDeps {
  getRoot: () => string | null
  report: (msg: string, isError?: boolean) => void
}

const PAUSE_MS = 150
const CHARS_BEFORE = 2000

export function initLocalInline(deps: LocalInlineDeps): void {
  let warmFor: string | null = null // the project whose model this window has seen finish learning
  let reported = false

  monaco.languages.registerInlineCompletionsProvider('*', {
    async provideInlineCompletions(model, position, _context, token) {
      const none = { items: [] }
      const root = deps.getRoot()
      if (!root || !settings.get<boolean>('localInline') || model.uri.scheme !== 'file') return none
      if (settings.get<boolean>('aiInline') && aiConfigured()) return none
      // Only at the end of a line: a suggestion in the middle of code would be about the wrong thing.
      const restOfLine = model.getValueInRange(new monaco.Range(position.lineNumber, position.column, position.lineNumber, model.getLineMaxColumn(position.lineNumber)))
      if (restOfLine.trim()) return none

      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS)) // a newer keystroke cancels this one first
      if (token.isCancellationRequested) return none

      const start = model.getFullModelRange().getStartPosition()
      const before = model.getValueInRange(new monaco.Range(start.lineNumber, start.column, position.lineNumber, position.column)).slice(-CHARS_BEFORE)
      if (!before.trim()) return none
      try {
        await indexedFiles(root) // opens the project index the first time
        // The first request for a project waits for the model to finish learning, so it is not asked while still empty.
        const found = await fileIndex.suggestLine(model.uri.fsPath, before, warmFor !== root)
        warmFor = root
        if (!found || token.isCancellationRequested) return none
        return { items: [{ insertText: found.text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] }
      } catch (err) {
        // Said once, so a broken index does not turn every pause into a message.
        if (!reported) {
          reported = true
          deps.report(`Line suggestions: ${err instanceof Error ? err.message : String(err)}`, true)
        }
        return none
      }
    },
    freeInlineCompletions: () => undefined
  })
}
