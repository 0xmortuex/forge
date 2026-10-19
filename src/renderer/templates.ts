import * as monaco from 'monaco-editor'
import { quickPick } from './quick'
import { userData } from './settings'

// Live templates (snippets) and Surround With.
//
// A live template is a short word that expands into code: type `forof`, press Tab. Built-in ones cover the common
// loops and blocks; your own go in `snippets/<language>.json` in Forge's data folder (VS Code's snippet format;
// `global.json` applies to every language). Surround With (Ctrl+Alt+T) wraps the selected lines in an `if`, `try`, a
// loop, brackets and so on.

interface Template {
  prefix: string
  /** Monaco snippet syntax: $1, ${2:placeholder}, $0 for the final cursor position. */
  body: string
  description: string
  /** Language ids it applies to; null for every language. */
  languages: string[] | null
}

const JS = ['javascript', 'typescript']
const t = (languages: string[] | null, prefix: string, description: string, body: string): Template => ({ prefix, body, description, languages })

const BUILTIN: Template[] = [
  t(JS, 'log', 'console.log()', 'console.log($1)$0'),
  t(JS, 'err', 'console.error()', 'console.error($1)$0'),
  t(JS, 'fori', 'for loop over an index', 'for (let ${1:i} = 0; $1 < ${2:array}.length; $1++) {\n\t$0\n}'),
  t(JS, 'forof', 'for…of loop', 'for (const ${1:item} of ${2:items}) {\n\t$0\n}'),
  t(JS, 'forin', 'for…in loop', 'for (const ${1:key} in ${2:object}) {\n\t$0\n}'),
  t(JS, 'fn', 'function', 'function ${1:name}(${2:params}) {\n\t$0\n}'),
  t(JS, 'afn', 'async function', 'async function ${1:name}(${2:params}) {\n\t$0\n}'),
  t(JS, 'arrow', 'arrow function', 'const ${1:name} = (${2:params}) => {\n\t$0\n}'),
  t(JS, 'iife', 'immediately invoked function', '(() => {\n\t$0\n})()'),
  t(JS, 'try', 'try / catch', 'try {\n\t$0\n} catch (${1:err}) {\n\tthrow ${1:err}\n}'),
  t(JS, 'imp', 'import', "import { $2 } from '${1:module}'"),
  t(JS, 'desc', 'describe block', "describe('${1:name}', () => {\n\t$0\n})"),
  t(JS, 'it', 'test case', "it('${1:does something}', () => {\n\t$0\n})"),
  t(['typescript'], 'iface', 'interface', 'interface ${1:Name} {\n\t$0\n}'),
  t(['typescript'], 'cls', 'class', 'class ${1:Name} {\n\tconstructor($2) {\n\t\t$0\n\t}\n}'),
  t(['python'], 'main', 'if __name__ == "__main__"', 'if __name__ == "__main__":\n\t${1:main()}'),
  t(['python'], 'def', 'function', 'def ${1:name}(${2:args}):\n\t${0:pass}'),
  t(['python'], 'cls', 'class', 'class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t${0:pass}'),
  t(['python'], 'for', 'for loop', 'for ${1:item} in ${2:items}:\n\t${0:pass}'),
  t(['python'], 'try', 'try / except', 'try:\n\t$0\nexcept ${1:Exception} as ${2:err}:\n\traise'),
  t(['python'], 'with', 'with statement', 'with ${1:open(path)} as ${2:f}:\n\t${0:pass}'),
  t(['python'], 'lc', 'list comprehension', '[${1:x} for ${2:x} in ${3:items}]'),
  t(['c', 'cpp'], 'main', 'main function', 'int main(int argc, char **argv) {\n\t$0\n\treturn 0;\n}'),
  t(['c', 'cpp'], 'for', 'for loop', 'for (int ${1:i} = 0; $1 < ${2:n}; $1++) {\n\t$0\n}'),
  t(['c', 'cpp'], 'inc', '#include', '#include <${1:stdio.h}>'),
  t(null, 'todo', 'TODO comment', 'TODO: $0'),
  t(null, 'fixme', 'FIXME comment', 'FIXME: $0')
]

/** Reads snippets/*.json. Anything wrong with a file is returned as a problem for the caller to report. */
function loadUserTemplates(): { templates: Template[]; problems: string[] } {
  const templates: Template[] = []
  const problems: string[] = []
  for (const file of userData.snippets) {
    const language = file.name.replace(/\.json$/i, '').toLowerCase()
    let parsed: unknown
    try {
      parsed = JSON.parse(file.text)
    } catch (err) {
      problems.push(`snippets/${file.name} is not valid JSON: ${(err as Error).message}`)
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      problems.push(`snippets/${file.name} must be a JSON object of snippets`)
      continue
    }
    for (const [name, raw] of Object.entries(parsed as Record<string, unknown>)) {
      const s = raw as { prefix?: unknown; body?: unknown; description?: unknown }
      const prefixes = Array.isArray(s.prefix) ? s.prefix : [s.prefix]
      const body = Array.isArray(s.body) ? s.body.join('\n') : s.body
      if (typeof body !== 'string' || !prefixes.every((p) => typeof p === 'string' && p)) {
        problems.push(`snippets/${file.name}: "${name}" needs a "prefix" and a "body"`)
        continue
      }
      for (const prefix of prefixes as string[]) {
        templates.push({ prefix, body, description: typeof s.description === 'string' ? s.description : name, languages: language === 'global' ? null : [language] })
      }
    }
  }
  return { templates, problems }
}

const user = loadUserTemplates()
const ALL = [...BUILTIN, ...user.templates]
/** Problems in the user's snippet files, for the app to report at startup. */
export const templateProblems = user.problems

const forLanguage = (language: string): Template[] => ALL.filter((x) => !x.languages || x.languages.includes(language))

function insertSnippet(editor: monaco.editor.IStandaloneCodeEditor, body: string): void {
  const controller = editor.getContribution('snippetController2') as { insert: (template: string) => void } | null
  if (!controller) throw new Error('This editor cannot insert snippets')
  controller.insert(body)
}

// ---- Surround With ----
interface Surround {
  label: string
  languages: string[] | null
  /** Wraps whole lines (indented block) rather than just the selected text. */
  block: boolean
  /** Builds the snippet. \`text\` is the (escaped) selection; for blocks, \`body(text)\` is it indented one level. */
  build: (text: string, ctx: { base: string; body: (s: string) => string }) => string
}

const wrap = (label: string, open: string, close: string, languages: string[] | null = null): Surround => ({
  label,
  languages,
  block: false,
  build: (text) => `${open}${text}$0${close}`
})
const braces = (label: string, head: string, languages: string[] | null, tail = '}'): Surround => ({
  label,
  languages,
  block: true,
  build: (_text, { base, body }) => `${base}${head}\n${body(_text)}\n${base}${tail}`
})
const indentedHeader = (label: string, head: string, languages: string[] | null): Surround => ({
  label,
  languages,
  block: true,
  build: (text, { base, body }) => `${base}${head}\n${body(text)}`
})

const SURROUNDS: Surround[] = [
  wrap('( … )', '(', ')'),
  wrap('[ … ]', '[', ']'),
  wrap('{ … }', '{', '}'),
  wrap("' … '", "'", "'"),
  wrap('" … "', '"', '"'),
  wrap('` … `', '`', '`', JS),
  { label: 'console.log( … )', languages: JS, block: false, build: (text) => `console.log(${text})$0` },
  braces('if (…) { … }', 'if (${1:condition}) {', [...JS, 'c', 'cpp']),
  braces('if (…) { … } else { … }', 'if (${1:condition}) {', JS),
  braces('while (…) { … }', 'while (${1:condition}) {', [...JS, 'c', 'cpp']),
  braces('for (const … of …) { … }', 'for (const ${1:item} of ${2:items}) {', JS),
  braces('try { … } catch', 'try {', JS, '} catch (${1:err}) {\n}'),
  braces('try { … } finally', 'try {', JS, '} finally {\n}'),
  braces('(() => { … })()', '(() => {', JS, '})()'),
  braces('// #region', '// #region ${1:name}', JS, '// #endregion'),
  braces('{ … } block', '{', ['c', 'cpp']),
  braces('#if 0 … #endif', '#if 0', ['c', 'cpp'], '#endif'),
  indentedHeader('if …:', 'if ${1:condition}:', ['python']),
  indentedHeader('for … in …:', 'for ${1:item} in ${2:items}:', ['python']),
  indentedHeader('while …:', 'while ${1:condition}:', ['python']),
  indentedHeader('with … as …:', 'with ${1:open(path)} as ${2:f}:', ['python']),
  indentedHeader('def …():', 'def ${1:name}(${2:args}):', ['python']),
  {
    label: 'try / except',
    languages: ['python'],
    block: true,
    build: (text, { base, body }) => `${base}try:\n${body(text)}\n${base}except \${1:Exception} as \${2:err}:\n${base}\traise`
  }
]

const escapeSnippet = (s: string): string => s.replace(/[\\$}]/g, (c) => '\\' + c)

export interface Templates {
  /** Insert Live Template…: pick a template valid for the file's language. */
  pickTemplate: () => void
  /** Surround With…: wrap the selection. */
  surround: () => void
  /** Registers the completion provider, so templates also show up (and expand with Tab) as you type. */
  init: () => void
}

export function initTemplates(editor: monaco.editor.IStandaloneCodeEditor): Templates {
  return {
    init() {
      // Tab expands a template when the word just before the cursor is exactly a template's prefix. A context key says
      // when that is the case, so every other Tab (indent, accepting a suggestion) behaves as usual.
      const atTemplate = editor.createContextKey<boolean>('forgeTemplateAtCursor', false)
      const wordTemplate = (): { range: monaco.Range; template: Template } | null => {
        const model = editor.getModel()
        const pos = editor.getPosition()
        if (!model || !pos || !editor.getSelection()?.isEmpty()) return null
        const word = model.getWordUntilPosition(pos)
        if (!word.word) return null
        const template = forLanguage(model.getLanguageId()).find((x) => x.prefix === word.word)
        return template ? { range: new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn), template } : null
      }
      const update = (): void => atTemplate.set(wordTemplate() !== null)
      editor.onDidChangeCursorPosition(update)
      editor.onDidChangeModel(update)
      editor.onDidChangeModelContent(update)
      editor.addCommand(
        monaco.KeyCode.Tab,
        () => {
          const hit = wordTemplate()
          if (!hit) return
          editor.setSelection(hit.range)
          insertSnippet(editor, hit.template.body)
        },
        // With a suggestion list open, Tab accepts the highlighted suggestion (which may be this very template, or a postfix one).
        'forgeTemplateAtCursor && editorTextFocus && !editorReadonly && !suggestWidgetVisible'
      )

      monaco.languages.registerCompletionItemProvider('*', {
        provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position)
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
          return {
            suggestions: forLanguage(model.getLanguageId()).map((x) => ({
              label: x.prefix,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: x.body,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: x.description,
              documentation: { value: '```\n' + x.body.replace(/\$\{\d+:?([^}]*)\}|\$\d+/g, '$1') + '\n```' },
              range,
              sortText: '0' + x.prefix // before the language server's items: an exact template is usually what you mean
            }))
          }
        }
      })
    },

    pickTemplate() {
      const model = editor.getModel()
      if (!model) return
      const items = forLanguage(model.getLanguageId()).map((x) => ({ label: x.prefix, detail: x.description, data: x }))
      quickPick({
        title: 'Insert Live Template',
        placeholder: 'Type to filter templates',
        items,
        emptyText: 'No templates for this language',
        onChoose: (x) => {
          editor.focus()
          insertSnippet(editor, x.body)
        }
      })
    },

    surround() {
      const model = editor.getModel()
      const sel = editor.getSelection()
      if (!model || !sel) return
      const items = SURROUNDS.filter((s) => !s.languages || s.languages.includes(model.getLanguageId())).map((s) => ({ label: s.label, data: s }))
      quickPick({
        title: 'Surround With',
        placeholder: 'Type to filter',
        items,
        emptyText: 'Nothing to surround with for this language',
        onChoose: (s) => {
          editor.focus()
          const opts = model.getOptions()
          const unit = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t'
          let range: monaco.Range
          if (s.block) {
            const from = sel.startLineNumber
            // A selection that ends at column 1 of a line doesn't include that line.
            const to = !sel.isEmpty() && sel.endColumn === 1 && sel.endLineNumber > from ? sel.endLineNumber - 1 : sel.endLineNumber
            range = new monaco.Range(from, 1, to, model.getLineMaxColumn(to))
          } else range = sel
          const text = model.getValueInRange(range)
          const base = /^[ \t]*/.exec(model.getLineContent(range.startLineNumber))?.[0] ?? ''
          const body = (raw: string): string =>
            raw
              .split(/\r?\n/)
              .map((line) => (line.trim() ? (line.startsWith(base) ? base + unit + line.slice(base.length) : unit + line) : line))
              .join('\n')
          // The text is escaped once; the template's own \`$\` placeholders must stay live, so indenting happens first.
          const snippet = s.block ? s.build(text, { base, body: (raw) => escapeSnippet(body(raw)) }) : s.build(escapeSnippet(text), { base, body })
          editor.setSelection(range)
          insertSnippet(editor, snippet)
        }
      })
    }
  }
}
