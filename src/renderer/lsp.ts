import * as monaco from 'monaco-editor'
import type {
  CompletionItem,
  CompletionList,
  Diagnostic,
  Hover,
  InsertReplaceEdit,
  Location,
  LocationLink,
  MarkedString,
  MarkupContent,
  Position as LspPosition,
  Range as LspRange,
  SignatureHelp,
  TextEdit
} from 'vscode-languageserver-protocol'

/** Monaco language ids that Forge can talk to a language server for (see BY_EXT in main/lsp.ts). */
const LANGUAGES = ['typescript', 'javascript', 'python', 'c', 'cpp', 'mort']

export interface LspDeps {
  getRoot: () => string | null
  openFile: (path: string, line?: number, column?: number) => Promise<void>
  report: (msg: string, isError?: boolean) => void
  onProblems: (errors: number, warnings: number) => void
}

interface Doc {
  model: monaco.editor.ITextModel
  uri: string // exactly as sent to the server
  opening: Promise<void>
  supported: boolean
  sentVersion: number
  timer: number | undefined
  errors: number
  warnings: number
}

// Windows paths are case-insensitive and servers differ on drive-letter case, so compare lowercased.
const keyOf = (uri: string | monaco.Uri): string => monaco.Uri.parse(uri.toString()).toString().toLowerCase()

const toLsp = (p: monaco.IPosition): LspPosition => ({ line: p.lineNumber - 1, character: p.column - 1 })
const toRange = (r: LspRange): monaco.IRange => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1
})

const CK = monaco.languages.CompletionItemKind
// Index = LSP CompletionItemKind (1-based); index 0 unused.
const COMPLETION_KINDS = [
  CK.Text, CK.Text, CK.Method, CK.Function, CK.Constructor, CK.Field, CK.Variable, CK.Class, CK.Interface,
  CK.Module, CK.Property, CK.Unit, CK.Value, CK.Enum, CK.Keyword, CK.Snippet, CK.Color, CK.File,
  CK.Reference, CK.Folder, CK.EnumMember, CK.Constant, CK.Struct, CK.Event, CK.Operator, CK.TypeParameter
]

const SEVERITY = [
  monaco.MarkerSeverity.Error, // unspecified: treat as error
  monaco.MarkerSeverity.Error,
  monaco.MarkerSeverity.Warning,
  monaco.MarkerSeverity.Info,
  monaco.MarkerSeverity.Hint
]

function toMarkdown(c: MarkedString | MarkupContent): monaco.IMarkdownString {
  if (typeof c === 'string') return { value: c }
  if ('kind' in c) return c.kind === 'markdown' ? { value: c.value } : { value: '```\n' + c.value + '\n```' }
  return { value: '```' + c.language + '\n' + c.value + '\n```' }
}

const docText = (d: string | MarkupContent | undefined): string | monaco.IMarkdownString | undefined =>
  d === undefined ? undefined : typeof d === 'string' ? d : toMarkdown(d)

export function initLsp(deps: LspDeps): {
  openDoc: (model: monaco.editor.ITextModel, path: string) => void
  closeDoc: (model: monaco.editor.ITextModel) => void
} {
  const docs = new Map<string, Doc>()
  // Completion items keep their raw LSP form so they can be resolved lazily.
  const rawItems = new WeakMap<object, { uri: string; raw: CompletionItem }>()

  const flush = async (doc: Doc): Promise<void> => {
    window.clearTimeout(doc.timer)
    doc.timer = undefined
    await doc.opening
    const version = doc.model.getVersionId()
    if (!doc.supported || version === doc.sentVersion) return
    doc.sentVersion = version
    await window.forge.lspChange(doc.uri, version, doc.model.getValue())
  }

  /** Sends pending edits first, then the request. Null if no server handles this document. */
  async function request<T>(model: monaco.editor.ITextModel, method: string, params: object): Promise<T | null> {
    const doc = docs.get(keyOf(model.uri))
    if (!doc) return null
    await doc.opening
    if (!doc.supported) return null
    await flush(doc)
    try {
      return (await window.forge.lspRequest(doc.uri, method, {
        textDocument: { uri: doc.uri },
        ...params
      })) as T | null
    } catch (err) {
      deps.report(`${method}: ${err instanceof Error ? err.message : String(err)}`, true)
      throw err
    }
  }

  function openDoc(model: monaco.editor.ITextModel, path: string): void {
    const root = deps.getRoot()
    if (!root) return
    const uri = model.uri.toString()
    const doc: Doc = {
      model, uri, supported: false, sentVersion: model.getVersionId(), timer: undefined,
      errors: 0, warnings: 0, opening: Promise.resolve()
    }
    doc.opening = window.forge
      .lspOpen(root, uri, path, model.getVersionId(), model.getValue())
      .then((supported) => {
        doc.supported = supported
      })
      .catch((err: unknown) => {
        // Reported loudly here; the document just gets no language features.
        deps.report(`Language server: ${err instanceof Error ? err.message : String(err)}`, true)
      })
    docs.set(keyOf(uri), doc)
    model.onDidChangeContent(() => {
      window.clearTimeout(doc.timer)
      doc.timer = window.setTimeout(() => void flush(doc).catch((e: unknown) => deps.report(String(e), true)), 150)
    })
  }

  function closeDoc(model: monaco.editor.ITextModel): void {
    const key = keyOf(model.uri)
    const doc = docs.get(key)
    if (!doc) return
    window.clearTimeout(doc.timer)
    docs.delete(key)
    publishProblems()
    void doc.opening
      .then(() => (doc.supported ? window.forge.lspClose(doc.uri) : undefined))
      .catch((err: unknown) => deps.report(`Language server close: ${String(err)}`, true))
  }

  function publishProblems(): void {
    let errors = 0
    let warnings = 0
    for (const d of docs.values()) {
      errors += d.errors
      warnings += d.warnings
    }
    deps.onProblems(errors, warnings)
  }

  // ---- Diagnostics ----
  window.forge.onLspDiagnostics((uri, raw) => {
    const doc = docs.get(keyOf(uri))
    if (!doc) return
    const diags = raw as Diagnostic[]
    monaco.editor.setModelMarkers(
      doc.model,
      'lsp',
      diags.map((d) => ({
        ...toRange(d.range),
        severity: SEVERITY[d.severity ?? 1] ?? monaco.MarkerSeverity.Error,
        message: typeof d.message === 'string' ? d.message : d.message.value,
        source: d.source,
        code: d.code === undefined ? undefined : String(d.code)
      }))
    )
    doc.errors = diags.filter((d) => (d.severity ?? 1) === 1).length
    doc.warnings = diags.filter((d) => d.severity === 2).length
    publishProblems()
  })

  // Only real problems are shown; chatty Info/Log messages are dropped on purpose.
  window.forge.onLspLog((server, type, message) => {
    if (type <= 2) deps.report(`[${server}] ${message}`, type === 1)
  })

  // ---- Providers ----
  monaco.languages.registerCompletionItemProvider(LANGUAGES, {
    triggerCharacters: ['.', '"', "'", '/', '@', '<', ':'],
    async provideCompletionItems(model, position, context) {
      const res = await request<CompletionItem[] | CompletionList>(model, 'textDocument/completion', {
        position: toLsp(position),
        // Monaco: Invoke=0, TriggerCharacter=1, Incomplete=2. LSP is the same, 1-based.
        context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter }
      })
      if (!res) return { suggestions: [] }
      const items = Array.isArray(res) ? res : res.items
      const word = model.getWordUntilPosition(position)
      const fallback: monaco.IRange = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn
      }
      const uri = model.uri.toString()
      const suggestions = items.map((item): monaco.languages.CompletionItem => {
        const edit = item.textEdit as TextEdit | InsertReplaceEdit | undefined
        const range: monaco.IRange | { insert: monaco.IRange; replace: monaco.IRange } = !edit
          ? fallback
          : 'range' in edit
            ? toRange(edit.range)
            : { insert: toRange(edit.insert), replace: toRange(edit.replace) }
        const out: monaco.languages.CompletionItem = {
          label: item.label,
          kind: COMPLETION_KINDS[item.kind ?? 1] ?? CK.Text,
          insertText: edit?.newText ?? item.insertText ?? item.label,
          insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range,
          detail: item.detail,
          documentation: docText(item.documentation),
          sortText: item.sortText,
          filterText: item.filterText,
          commitCharacters: item.commitCharacters,
          tags: item.deprecated || item.tags?.includes(1) ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
          additionalTextEdits: item.additionalTextEdits?.map((e) => ({ range: toRange(e.range), text: e.newText }))
        }
        rawItems.set(out, { uri, raw: item })
        return out
      })
      return { suggestions, incomplete: !Array.isArray(res) && res.isIncomplete }
    },
    async resolveCompletionItem(item) {
      const entry = rawItems.get(item)
      if (!entry) return item
      const full = (await window.forge.lspRequest(entry.uri, 'completionItem/resolve', entry.raw)) as CompletionItem | null
      if (!full) return item
      item.detail = full.detail ?? item.detail
      item.documentation = docText(full.documentation) ?? item.documentation
      if (full.additionalTextEdits) {
        item.additionalTextEdits = full.additionalTextEdits.map((e) => ({ range: toRange(e.range), text: e.newText }))
      }
      return item
    }
  })

  monaco.languages.registerHoverProvider(LANGUAGES, {
    async provideHover(model, position) {
      const hover = await request<Hover>(model, 'textDocument/hover', { position: toLsp(position) })
      if (!hover?.contents) return null
      const parts = Array.isArray(hover.contents) ? hover.contents : [hover.contents]
      return { contents: parts.map(toMarkdown), range: hover.range ? toRange(hover.range) : undefined }
    }
  })

  monaco.languages.registerSignatureHelpProvider(LANGUAGES, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [')'],
    async provideSignatureHelp(model, position) {
      const help = await request<SignatureHelp>(model, 'textDocument/signatureHelp', { position: toLsp(position) })
      if (!help?.signatures.length) return null
      return {
        value: {
          signatures: help.signatures.map((s) => ({
            label: s.label,
            documentation: docText(s.documentation),
            parameters: (s.parameters ?? []).map((p) => ({ label: p.label, documentation: docText(p.documentation) })),
            activeParameter: s.activeParameter ?? undefined
          })),
          activeSignature: help.activeSignature ?? 0,
          activeParameter: help.activeParameter ?? 0
        },
        dispose: () => undefined
      }
    }
  })

  monaco.languages.registerDefinitionProvider(LANGUAGES, {
    async provideDefinition(model, position) {
      const res = await request<Location | Location[] | LocationLink[]>(model, 'textDocument/definition', {
        position: toLsp(position)
      })
      if (!res) return null
      const list = Array.isArray(res) ? res : [res]
      return list.map((l): monaco.languages.Location | monaco.languages.LocationLink =>
        'targetUri' in l
          ? {
              uri: monaco.Uri.parse(l.targetUri),
              range: toRange(l.targetRange),
              targetSelectionRange: toRange(l.targetSelectionRange),
              originSelectionRange: l.originSelectionRange ? toRange(l.originSelectionRange) : undefined
            }
          : { uri: monaco.Uri.parse(l.uri), range: toRange(l.range) }
      )
    }
  })

  // Go-to-definition into a file that isn't open: open it in a tab instead of Monaco's own model.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selection) {
      const sel = selection as (monaco.IRange & monaco.IPosition) | undefined
      const line = sel?.startLineNumber ?? sel?.lineNumber
      const column = sel?.startColumn ?? sel?.column
      void deps.openFile(resource.fsPath, line, column)
      return true
    }
  })

  return { openDoc, closeDoc }
}
