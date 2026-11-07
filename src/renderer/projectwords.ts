import * as monaco from 'monaco-editor'
import { settings } from './settings'
import { fileIndex, indexedFiles } from './rpc'

// Completion from the words of the whole project, not just the open file: the local, no-network kind. The suggestions come
// from the project index (identifiers counted in every text file) and are plain words, ranked by how often the project uses
// them. They sit after the language server's own items, and the whole thing is off unless "Complete words from the whole
// project" is switched on in Settings.

export interface ProjectWordsDeps {
  getRoot: () => string | null
  report: (msg: string, isError?: boolean) => void
}

/** Fewer characters than this and almost every word matches: noise, not help. */
const MIN_TYPED = 3
const MAX_SUGGESTIONS = 30

export function initProjectWords(deps: ProjectWordsDeps): void {
  let reported = false
  let warmFor: string | null = null // the project whose word index this window has seen complete
  monaco.languages.registerCompletionItemProvider('*', {
    async provideCompletionItems(model, position) {
      const root = deps.getRoot()
      if (!root || !settings.get<boolean>('projectWords')) return { suggestions: [] }
      const word = model.getWordUntilPosition(position)
      if (word.word.length < MIN_TYPED) return { suggestions: [] }
      try {
        await indexedFiles(root) // opens the project index the first time
        // The first request for a project waits for the index to finish building, so its answer is complete; later ones are instant.
        const hits = await fileIndex.completeWord(word.word, MAX_SUGGESTIONS, warmFor !== root)
        warmFor = root
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
        return {
          suggestions: hits.map((h, i) => ({
            label: h.word,
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: h.word,
            range,
            detail: 'project word',
            documentation: `${h.count} ${h.count === 1 ? 'use' : 'uses'} in the project`,
            sortText: 'zzz' + String(i).padStart(3, '0') // after the language server's items, in ranking order
          }))
        }
      } catch (err) {
        // Said once, so a broken index does not turn every keystroke into a message.
        if (!reported) {
          reported = true
          deps.report(`Project words: ${err instanceof Error ? err.message : String(err)}`, true)
        }
        return { suggestions: [] }
      }
    }
  })
}
