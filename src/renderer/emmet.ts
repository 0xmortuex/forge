import * as monaco from 'monaco-editor'
import expand, { extract } from 'emmet'
import { settings } from './settings'

// Emmet: type `ul>li*3` or `df` and expand it to markup or CSS. It is offered as a completion (Enter/Tab accepts it) and, when
// no completion is showing, Tab expands the abbreviation before the cursor. Only in HTML and CSS-family files.

export type EmmetKind = 'markup' | 'stylesheet'

const MARKUP = ['html', 'xml', 'handlebars', 'razor']
const STYLESHEET = ['css', 'scss', 'less']

export const emmetKindFor = (languageId: string): EmmetKind | null => (MARKUP.includes(languageId) ? 'markup' : STYLESHEET.includes(languageId) ? 'stylesheet' : null)

/** Words that are an abbreviation on their own (a tag name); other plain words are just text. */
const TAGS = new Set(
  'a abbr address article aside audio b blockquote body br button canvas caption code col dd details div dl dt em fieldset figure footer form h1 h2 h3 h4 h5 h6 head header hr html i iframe img input label legend li link main nav ol option p pre script section select small span strong style sub summary sup table tbody td template textarea tfoot th thead title tr u ul video'.split(' ')
)

/** Characters that make an abbreviation an abbreviation: nesting, siblings, multiplication, class, id, attributes, text, grouping. */
const OPERATORS = /[>+*^.#[\]{}()$@:!]/

export interface Expansion {
  /** 0-based columns of the abbreviation in the line. */
  start: number
  end: number
  abbreviation: string
  /** The expansion as a Monaco snippet (with tab stops). */
  snippet: string
  /** The expansion as plain text, for the suggestion's documentation. */
  preview: string
}

/** Escapes text so a snippet inserts it literally. */
const escapeSnippet = (text: string): string => text.replace(/[\\$}]/g, '\\$&')

/**
 * The expansion of the abbreviation that ends at `column` (0-based) of `line`, or null if there is none or it is just a word.
 * `indent` is one level of indentation; the line's own indentation is carried over to the following lines of the result.
 */
export function expansionAt(line: string, column: number, kind: EmmetKind, syntax: string, indent: string): Expansion | null {
  const found = extract(line, column, { type: kind, lookAhead: false })
  if (!found) return null
  const abbreviation = found.abbreviation
  if (kind === 'markup' && !OPERATORS.test(abbreviation) && !TAGS.has(abbreviation)) return null
  const baseIndent = /^\s*/.exec(line)?.[0] ?? ''
  const options = {
    'output.indent': indent,
    'output.baseIndent': baseIndent
  }
  let snippet: string
  let preview: string
  try {
    snippet = expand(abbreviation, {
      type: kind,
      syntax,
      options: { ...options, 'output.field': (index: number, placeholder: string) => `\${${index}${placeholder ? `:${escapeSnippet(placeholder)}` : ''}}`, 'output.text': escapeSnippet }
    })
    preview = expand(abbreviation, { type: kind, syntax, options: { ...options, 'output.field': (_i: number, placeholder: string) => placeholder } })
  } catch {
    return null // not a valid abbreviation (for example a half-typed one)
  }
  if (!snippet || snippet === abbreviation) return null
  // The first line carries no base indent: it continues the line that is already there.
  const strip = (s: string): string => (baseIndent && s.startsWith(baseIndent) ? s.slice(baseIndent.length) : s)
  return { start: found.start, end: found.end, abbreviation, snippet: strip(snippet), preview: strip(preview) }
}

const indentOf = (model: monaco.editor.ITextModel): string => (model.getOptions().insertSpaces ? ' '.repeat(model.getOptions().tabSize) : '\t')

export function initEmmet(editor: monaco.editor.IStandaloneCodeEditor): void {
  monaco.languages.registerCompletionItemProvider([...MARKUP, ...STYLESHEET], {
    triggerCharacters: ['>', '+', '*', '.', '#', ')', ']', '}', ':', '!', '^'],
    provideCompletionItems(model, position) {
      if (!settings.get<boolean>('emmet')) return { suggestions: [] }
      const kind = emmetKindFor(model.getLanguageId())
      if (!kind) return { suggestions: [] }
      const e = expansionAt(model.getLineContent(position.lineNumber), position.column - 1, kind, model.getLanguageId(), indentOf(model))
      if (!e) return { suggestions: [] }
      return {
        suggestions: [
          {
            label: e.abbreviation,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: 'Emmet abbreviation',
            documentation: { value: '```\n' + e.preview + '\n```' },
            insertText: e.snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: { startLineNumber: position.lineNumber, startColumn: e.start + 1, endLineNumber: position.lineNumber, endColumn: e.end + 1 },
            filterText: e.abbreviation,
            sortText: '\u0000',
            preselect: true
          }
        ]
      }
    }
  })

  // Tab expands when no completion list is open (with one open, Tab accepts the highlighted entry as usual). A Tab with
  // nothing to expand does what it always does. The `when` keeps this to HTML/CSS files, so Tab elsewhere is untouched.
  const langs = [...MARKUP, ...STYLESHEET].map((l) => `editorLangId == ${l}`).join(' || ')
  editor.addCommand(
    monaco.KeyCode.Tab,
    () => {
      // The command registry is shared by all editors: act on the one with the cursor.
      const ed = monaco.editor.getEditors().find((e) => e.hasTextFocus()) ?? monaco.editor.getEditors()[0]
      const model = ed?.getModel()
      const pos = ed?.getPosition()
      if (!ed || !model || !pos) return
      const kind = emmetKindFor(model.getLanguageId())
      const e = kind && settings.get<boolean>('emmet') ? expansionAt(model.getLineContent(pos.lineNumber), pos.column - 1, kind, model.getLanguageId(), indentOf(model)) : null
      if (!e) {
        ed.trigger('emmet', 'tab', null)
        return
      }
      // The snippet controller replaces the selection (the abbreviation) with the expansion and leaves its tab stops active.
      const snippets = ed.getContribution<{ insert: (template: string) => void } & monaco.editor.IEditorContribution>('snippetController2')
      if (!snippets) throw new Error('The editor has no snippet support, so Emmet cannot expand')
      ed.setSelection(new monaco.Selection(pos.lineNumber, e.start + 1, pos.lineNumber, e.end + 1))
      snippets.insert(e.snippet)
    },
    `!suggestWidgetVisible && !inSnippetMode && !editorHasSelection && editorTextFocus && !editorReadonly && (${langs})`
  )
}
