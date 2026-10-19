import * as monaco from 'monaco-editor'
import { postfixAt, POSTFIX_LANGUAGES } from './postfixcore'
import { settings } from './settings'

// Postfix completion: after `expression.` the editor offers templates (log, if, for, return...) that rewrite the whole
// expression, e.g. `items.for` -> `for (const item of items) { }`. The templates themselves live in postfixcore.ts.

export function initPostfix(): void {
  monaco.languages.registerCompletionItemProvider(POSTFIX_LANGUAGES, {
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      if (!settings.get<boolean>('postfix')) return { suggestions: [] }
      const matches = postfixAt(model.getLanguageId(), model.getLineContent(position.lineNumber), position.column - 1)
      return {
        suggestions: matches.map((m) => ({
          label: { label: `.${m.key}`, description: m.description },
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: 'Postfix template',
          insertText: m.snippet,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          // The expression, the dot and what was typed after it are all replaced.
          range: { startLineNumber: position.lineNumber, startColumn: m.start + 1, endLineNumber: position.lineNumber, endColumn: m.end + 1 },
          filterText: `${m.expression}.${m.key}`,
          sortText: `0${m.key}`
        }))
      }
    }
  })
}
