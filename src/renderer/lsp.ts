import * as monaco from 'monaco-editor'
import { askText } from './menu'
import { settings } from './settings'
import { applyWorkspaceEdit } from './lsp-edits'
import type { HierarchyNode, HierarchyRoot } from './hierarchy'
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  CodeAction,
  CodeLens as LspCodeLens,
  Command,
  CompletionItem,
  CompletionList,
  Diagnostic,
  DocumentHighlight,
  DocumentSymbol,
  FoldingRange,
  Hover,
  InlayHint,
  InsertReplaceEdit,
  Location,
  LocationLink,
  MarkedString,
  MarkupContent,
  Position as LspPosition,
  Range as LspRange,
  SelectionRange,
  ServerCapabilities,
  SignatureHelp,
  SymbolInformation,
  TextEdit,
  TypeHierarchyItem,
  WorkspaceEdit,
  WorkspaceSymbol
} from 'vscode-languageserver-protocol'

/** Monaco language ids that Forge can talk to a language server for (see BY_EXT in main/lsp.ts). */
const LANGUAGES = ['typescript', 'javascript', 'python', 'c', 'cpp', 'mort']

/** One match of a project-wide symbol search. */
export interface SymbolHit {
  name: string
  /** LSP SymbolKind (1-based). */
  kind: number
  container?: string
  path: string
  line: number
  column: number
}

/** An error that has already been shown to the user, so callers must not report it again. */
class Reported extends Error {}

export interface LspDeps {
  editor: monaco.editor.IStandaloneCodeEditor
  /** The open model for a path, if the file is open in a tab. */
  getModel: (path: string) => monaco.editor.ITextModel | undefined
  /** Shows Find Usages results (in the Find panel). `what` names them: "usage" (default), "implementation" ... */
  showUsages: (symbol: string, hits: { path: string; line: number; text: string }[], what?: string) => void
  /** Shows a call or type hierarchy in its window. */
  showHierarchy: (root: HierarchyRoot) => void
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
  diagnostics: Diagnostic[] // the server's own, kept for code-action requests
  caps?: Promise<ServerCapabilities>
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
  /** Runs `fn` (a format request) without complaining when the language has no formatter. */
  quietFormat: <T>(fn: () => Promise<T>) => Promise<T>
  /** The file's symbols as a tree; null when no language server handles it. */
  documentSymbols: (model: monaco.editor.ITextModel) => Promise<monaco.languages.DocumentSymbol[] | null>
  /** Symbols matching `query` anywhere in the project (from every running language server). */
  workspaceSymbols: (query: string) => Promise<SymbolHit[]>
  /** Before files are renamed or moved: lets the language servers update imports. Returns how many edits were made. */
  willRename: (files: { from: string; to: string }[]) => Promise<number>
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
      const message = `${method}: ${err instanceof Error ? err.message : String(err)}`
      deps.report(message, true)
      throw new Reported(message)
    }
  }

  function openDoc(model: monaco.editor.ITextModel, path: string): void {
    const root = deps.getRoot()
    if (!root) return
    const uri = model.uri.toString()
    const doc: Doc = {
      model, uri, supported: false, sentVersion: model.getVersionId(), timer: undefined,
      errors: 0, warnings: 0, diagnostics: [], opening: Promise.resolve()
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
    doc.diagnostics = diags
    monaco.editor.setModelMarkers(
      doc.model,
      'lsp',
      diags.map((d) => ({
        ...toRange(d.range),
        severity: SEVERITY[d.severity ?? 1] ?? monaco.MarkerSeverity.Error,
        message: typeof d.message === 'string' ? d.message : d.message.value,
        source: d.source,
        code: d.code === undefined ? undefined : String(d.code),
        tags: d.tags?.map((t) => (t === 1 ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated))
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

  // ---- Refactoring: formatting, find usages, rename, quick fixes ----
  const capabilities = async (model: monaco.editor.ITextModel): Promise<ServerCapabilities | null> => {
    const doc = docs.get(keyOf(model.uri))
    if (!doc) return null
    await doc.opening
    if (!doc.supported) return null
    doc.caps ??= window.forge.lspCapabilities(doc.uri) as Promise<ServerCapabilities>
    return doc.caps
  }

  // ---- Symbols: the Structure window, Go to Symbol in File (Ctrl+Shift+O) and sticky scroll ----
  // LSP SymbolKind is Monaco's SymbolKind plus one.
  const toSymbol = (s: DocumentSymbol | SymbolInformation): monaco.languages.DocumentSymbol => {
    const tags = s.tags?.includes(1) ? [monaco.languages.SymbolTag.Deprecated] : []
    const kind = (s.kind - 1) as monaco.languages.SymbolKind
    if ('location' in s) {
      // The older, flat form: the range is the whole symbol and the container is only a name.
      const range = toRange(s.location.range)
      return { name: s.name, detail: '', kind, tags, containerName: s.containerName, range, selectionRange: range }
    }
    return {
      name: s.name, detail: s.detail ?? '', kind, tags,
      range: toRange(s.range), selectionRange: toRange(s.selectionRange),
      children: s.children?.map(toSymbol)
    }
  }

  /** The file's symbols as a tree. Null when no language server handles the file (or it can't list symbols). */
  async function documentSymbols(model: monaco.editor.ITextModel): Promise<monaco.languages.DocumentSymbol[] | null> {
    if (!(await capabilities(model))?.documentSymbolProvider) return null
    const res = await request<(DocumentSymbol | SymbolInformation)[]>(model, 'textDocument/documentSymbol', {})
    return (res ?? []).map(toSymbol)
  }

  monaco.languages.registerDocumentHighlightProvider(LANGUAGES, {
    async provideDocumentHighlights(model, position) {
      if (!(await capabilities(model))?.documentHighlightProvider) return null
      const res = await request<DocumentHighlight[]>(model, 'textDocument/documentHighlight', { position: toLsp(position) })
      // LSP DocumentHighlightKind (Text 1, Read 2, Write 3) is Monaco's plus one.
      return res?.map((h) => ({ range: toRange(h.range), kind: ((h.kind ?? 1) - 1) as monaco.languages.DocumentHighlightKind })) ?? null
    }
  })

  const FRK = monaco.languages.FoldingRangeKind
  monaco.languages.registerFoldingRangeProvider(LANGUAGES, {
    async provideFoldingRanges(model) {
      if (!(await capabilities(model))?.foldingRangeProvider) return null
      const res = await request<FoldingRange[]>(model, 'textDocument/foldingRange', {})
      return (
        res?.map((r) => ({
          start: r.startLine + 1,
          end: r.endLine + 1,
          kind: r.kind === 'comment' ? FRK.Comment : r.kind === 'imports' ? FRK.Imports : r.kind === 'region' ? FRK.Region : undefined
        })) ?? null
      )
    }
  })

  monaco.languages.registerSelectionRangeProvider(LANGUAGES, {
    async provideSelectionRanges(model, positions) {
      if (!(await capabilities(model))?.selectionRangeProvider) return null
      const res = await request<SelectionRange[]>(model, 'textDocument/selectionRange', { positions: positions.map(toLsp) })
      // Monaco wants each position's chain from the innermost range outwards.
      return (
        res?.map((sr) => {
          const chain: monaco.languages.SelectionRange[] = []
          for (let r: SelectionRange | undefined = sr; r; r = r.parent) chain.push({ range: toRange(r.range) })
          return chain
        }) ?? null
      )
    }
  })

  monaco.languages.registerInlayHintsProvider(LANGUAGES, {
    async provideInlayHints(model, range) {
      const none = { hints: [], dispose: () => undefined }
      if (!(await capabilities(model))?.inlayHintProvider) return none
      const res = await request<InlayHint[]>(model, 'textDocument/inlayHint', {
        range: { start: { line: range.startLineNumber - 1, character: range.startColumn - 1 }, end: { line: range.endLineNumber - 1, character: range.endColumn - 1 } }
      })
      const hints = (res ?? []).map(
        (h): monaco.languages.InlayHint => ({
          label: typeof h.label === 'string' ? h.label : h.label.map((p) => p.value).join(''),
          position: { lineNumber: h.position.line + 1, column: h.position.character + 1 },
          kind: h.kind as monaco.languages.InlayHintKind | undefined, // LSP Type 1 / Parameter 2 are Monaco's too
          paddingLeft: h.paddingLeft,
          paddingRight: h.paddingRight
        })
      )
      return { hints, dispose: () => undefined }
    }
  })

  // "N usages" above declarations (IntelliJ's Code Vision), from the server's code lenses.
  const lensSource = new WeakMap<monaco.languages.CodeLens, LspCodeLens>()
  const lensChanged = new monaco.Emitter<monaco.languages.CodeLensProvider>()
  settings.onChange((key) => {
    if (key === 'codeVision') lensChanged.fire(lensProvider)
  })
  const lensProvider: monaco.languages.CodeLensProvider = {
    onDidChange: lensChanged.event,
    async provideCodeLenses(model) {
      const none = { lenses: [], dispose: () => undefined }
      if (!settings.get<boolean>('codeVision') || !(await capabilities(model))?.codeLensProvider) return none
      const res = await request<LspCodeLens[]>(model, 'textDocument/codeLens', {})
      const lenses = (res ?? []).map((l): monaco.languages.CodeLens => {
        const lens: monaco.languages.CodeLens = { range: toRange(l.range) }
        lensSource.set(lens, l)
        return lens
      })
      return { lenses, dispose: () => undefined }
    },
    async resolveCodeLens(model, lens) {
      const source = lensSource.get(lens)
      if (!source) return lens
      const resolved = await request<LspCodeLens>(model, 'codeLens/resolve', source)
      if (resolved?.command) {
        // The server's command (editor.action.showReferences) is a VS Code one; ours opens Forge's own usages list.
        lens.command = { id: 'forge.showUsages', title: resolved.command.title, arguments: [model.uri.toString(), lens.range.startLineNumber, lens.range.startColumn] }
      }
      return lens
    }
  }
  monaco.languages.registerCodeLensProvider(LANGUAGES, lensProvider)
  monaco.editor.registerCommand('forge.showUsages', (_accessor, uri: string, line: number, column: number) => {
    if (deps.editor.getModel()?.uri.toString() !== uri) return deps.report('Usages can be listed from the main editor only', true)
    deps.editor.setPosition({ lineNumber: line, column })
    safe('Find Usages', findUsages)()
  })

  monaco.languages.registerDocumentSymbolProvider(LANGUAGES, {
    displayName: 'Language server',
    async provideDocumentSymbols(model) {
      return (await documentSymbols(model)) ?? []
    }
  })
  let quietFormat = false
  const unsupported = (model: monaco.editor.ITextModel, what: string): void => {
    if (quietFormat && what.startsWith('formatting')) return
    deps.report(`The language server for ${model.getLanguageId()} doesn't support ${what}`, true)
  }

  const toMonacoRange = (r: monaco.IRange): LspRange => ({
    start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
    end: { line: r.endLineNumber - 1, character: r.endColumn - 1 }
  })
  const toEdits = (edits: TextEdit[] | null): monaco.languages.TextEdit[] =>
    (edits ?? []).map((e) => ({ range: toRange(e.range), text: e.newText }))
  const formatOptions = (o: monaco.languages.FormattingOptions): object => ({ tabSize: o.tabSize, insertSpaces: o.insertSpaces })

  monaco.languages.registerDocumentFormattingEditProvider(LANGUAGES, {
    displayName: 'Language server',
    async provideDocumentFormattingEdits(model, options) {
      if (!(await capabilities(model))?.documentFormattingProvider) {
        unsupported(model, 'formatting')
        return []
      }
      return toEdits(await request<TextEdit[]>(model, 'textDocument/formatting', { options: formatOptions(options) }))
    }
  })
  monaco.languages.registerDocumentRangeFormattingEditProvider(LANGUAGES, {
    displayName: 'Language server',
    async provideDocumentRangeFormattingEdits(model, range, options) {
      if (!(await capabilities(model))?.documentRangeFormattingProvider) {
        unsupported(model, 'formatting a selection')
        return []
      }
      return toEdits(
        await request<TextEdit[]>(model, 'textDocument/rangeFormatting', { range: toMonacoRange(range), options: formatOptions(options) })
      )
    }
  })

  /** User-triggered actions report their own failures; requests already reported theirs. */
  const safe = (label: string, fn: () => Promise<void>) => async (): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      if (!(err instanceof Reported)) deps.report(`${label}: ${err instanceof Error ? err.message : String(err)}`, true)
    }
  }

  async function lineTexts(path: string): Promise<string[]> {
    const open = deps.getModel(path)
    const text = open ? open.getValue() : await window.forge.readFile(path)
    return text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  }

  async function findUsages(): Promise<void> {
    const model = deps.editor.getModel()
    const pos = deps.editor.getPosition()
    if (!model || !pos) return
    if (!(await capabilities(model))?.referencesProvider) return unsupported(model, 'Find Usages')
    const locations = await request<Location[]>(model, 'textDocument/references', {
      position: toLsp(pos),
      context: { includeDeclaration: true }
    })
    const word = model.getWordAtPosition(pos)?.word ?? ''
    const cache = new Map<string, string[]>()
    const hits: { path: string; line: number; text: string }[] = []
    for (const loc of locations ?? []) {
      const path = monaco.Uri.parse(loc.uri).fsPath
      let lines = cache.get(path)
      if (!lines) {
        lines = await lineTexts(path)
        cache.set(path, lines)
      }
      hits.push({ path, line: loc.range.start.line + 1, text: (lines[loc.range.start.line] ?? '').trim() })
    }
    hits.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
    if (!hits.length) deps.report(`No usages of ${word || 'the symbol'} found`)
    deps.showUsages(word, hits)
  }

  async function renameSymbol(): Promise<void> {
    const model = deps.editor.getModel()
    const pos = deps.editor.getPosition()
    if (!model || !pos) return
    const caps = await capabilities(model)
    if (!caps?.renameProvider) return unsupported(model, 'Rename')
    const word = model.getWordAtPosition(pos)
    if (!word) return deps.report('Put the cursor on a symbol to rename it', true)
    let placeholder = word.word
    if (typeof caps.renameProvider === 'object' && caps.renameProvider.prepareProvider) {
      const prep = await request<{ placeholder?: string } | null>(model, 'textDocument/prepareRename', { position: toLsp(pos) })
      if (!prep) return deps.report(`"${word.word}" can't be renamed here`, true)
      placeholder = prep.placeholder ?? placeholder
    }
    const name = await askText('Rename symbol', placeholder)
    if (!name || name === placeholder) return
    const edit = await request<WorkspaceEdit>(model, 'textDocument/rename', { position: toLsp(pos), newName: name })
    if (!edit) return deps.report('The language server returned no edits for the rename', true)
    const res = await applyWorkspaceEdit(edit, { getModel: deps.getModel })
    deps.report(
      `Renamed ${placeholder} → ${name}: ${res.edits} edit${res.edits === 1 ? '' : 's'} in ${res.files} file${res.files === 1 ? '' : 's'} (open files are unsaved)`
    )
  }

  deps.editor.addAction({
    id: 'forge.findUsages',
    label: 'Find Usages',
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F7, monaco.KeyMod.Shift | monaco.KeyCode.F12],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.6,
    run: safe('Find Usages', findUsages)
  })
  // Go to Implementation / Type Definition. One answer jumps there; several are listed in the Find window (Monaco's
  // own peek can only show files that are already open).
  async function gotoKind(method: string, cap: 'implementationProvider' | 'typeDefinitionProvider', what: string): Promise<void> {
    const model = deps.editor.getModel()
    const pos = deps.editor.getPosition()
    if (!model || !pos) return
    if (!(await capabilities(model))?.[cap]) return unsupported(model, `Go to ${what}`)
    const res = await request<Location | Location[] | LocationLink[]>(model, method, { position: toLsp(pos) })
    const list = res ? (Array.isArray(res) ? res : [res]) : []
    const word = model.getWordAtPosition(pos)?.word ?? ''
    if (!list.length) return deps.report(`No ${what} found for ${word || 'the symbol'}`)
    const cache = new Map<string, string[]>()
    const hits: { path: string; line: number; column: number; text: string }[] = []
    for (const l of list) {
      const at = 'targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange } : { uri: l.uri, range: l.range }
      const path = monaco.Uri.parse(at.uri).fsPath
      let lines = cache.get(path)
      if (!lines) {
        lines = await lineTexts(path)
        cache.set(path, lines)
      }
      hits.push({ path, line: at.range.start.line + 1, column: at.range.start.character + 1, text: (lines[at.range.start.line] ?? '').trim() })
    }
    const first = hits[0]
    if (hits.length === 1 && first) return void deps.openFile(first.path, first.line, first.column)
    hits.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
    deps.showUsages(word, hits, what)
  }

  // Applies a code action the server offered: its edit, then its command (resolving the edit first if needed).
  async function applyCodeAction(uri: string, action: CodeAction): Promise<void> {
    let a = action
    if (!a.edit && !a.command) {
      // Many servers send fixes without their edit and fill it in on demand.
      const caps = await window.forge.lspCapabilities(uri)
      const provider = (caps as ServerCapabilities).codeActionProvider
      if (typeof provider === 'object' && provider.resolveProvider) {
        a = (await window.forge.lspRequest(uri, 'codeAction/resolve', a)) as CodeAction
      }
    }
    if (a.edit) {
      const res = await applyWorkspaceEdit(a.edit, { getModel: deps.getModel })
      deps.report(`${a.title}: ${res.edits} edit${res.edits === 1 ? '' : 's'}`)
    }
    if (a.command) {
      await window.forge.lspRequest(uri, 'workspace/executeCommand', { command: a.command.command, arguments: a.command.arguments })
    }
    if (!a.edit && !a.command) throw new Error('The language server offered no edit or command for this fix')
  }

  async function organizeImports(): Promise<void> {
    const model = deps.editor.getModel()
    if (!model) return
    if (!(await capabilities(model))?.codeActionProvider) return unsupported(model, 'Optimize Imports')
    const doc = docs.get(keyOf(model.uri))
    if (!doc) return
    const res = await request<(CodeAction | Command)[]>(model, 'textDocument/codeAction', {
      range: toMonacoRange(model.getFullModelRange()),
      context: { diagnostics: [], only: ['source.organizeImports'] }
    })
    const action = res?.find((a): a is CodeAction => 'kind' in a && typeof a.kind === 'string' && a.kind.startsWith('source.organizeImports'))
    if (!action) return deps.report('The imports are already organized')
    await applyCodeAction(doc.uri, action)
  }

  // ---- Hierarchies ----
  const posOf = (it: { selectionRange: LspRange }): { line: number; column: number } => ({
    line: it.selectionRange.start.line + 1,
    column: it.selectionRange.start.character + 1
  })
  const nodeOf = (origin: string, it: CallHierarchyItem | TypeHierarchyItem, children: () => Promise<(CallHierarchyItem | TypeHierarchyItem)[]>): HierarchyNode => ({
    name: it.name,
    detail: it.detail,
    kind: it.kind,
    path: monaco.Uri.parse(it.uri).fsPath,
    ...posOf(it),
    children: async () => (await children()).map((c) => nodeOf(origin, c, () => childrenOf(origin, c)))
  })
  // Which request lists a node's children depends on which hierarchy it belongs to; `mode` is remembered per tree.
  let mode: 'incoming' | 'outgoing' | 'supertypes' | 'subtypes' = 'incoming'
  async function childrenOf(origin: string, it: CallHierarchyItem | TypeHierarchyItem): Promise<(CallHierarchyItem | TypeHierarchyItem)[]> {
    const ask = <T,>(method: string): Promise<T | null> => window.forge.lspRequest(origin, method, { item: it }) as Promise<T | null>
    if (mode === 'incoming') return ((await ask<CallHierarchyIncomingCall[]>('callHierarchy/incomingCalls')) ?? []).map((c) => c.from)
    if (mode === 'outgoing') return ((await ask<CallHierarchyOutgoingCall[]>('callHierarchy/outgoingCalls')) ?? []).map((c) => c.to)
    return (await ask<TypeHierarchyItem[]>(mode === 'supertypes' ? 'typeHierarchy/supertypes' : 'typeHierarchy/subtypes')) ?? []
  }

  async function hierarchy(kind: 'call' | 'type', direction: 'incoming' | 'outgoing' | 'supertypes' | 'subtypes'): Promise<void> {
    const model = deps.editor.getModel()
    const pos = deps.editor.getPosition()
    if (!model || !pos) return
    const cap = kind === 'call' ? 'callHierarchyProvider' : 'typeHierarchyProvider'
    if (!(await capabilities(model))?.[cap]) return unsupported(model, kind === 'call' ? 'Call Hierarchy' : 'Type Hierarchy')
    const doc = docs.get(keyOf(model.uri))
    if (!doc) return
    const items = await request<(CallHierarchyItem | TypeHierarchyItem)[]>(
      model,
      kind === 'call' ? 'textDocument/prepareCallHierarchy' : 'textDocument/prepareTypeHierarchy',
      { position: toLsp(pos) }
    )
    if (!items?.length) return deps.report(`There is no ${kind} hierarchy at the cursor`)
    const build = (dir: typeof direction): HierarchyRoot => {
      mode = dir
      const labels: Record<typeof direction, [string, typeof direction, string]> = {
        incoming: ['Callers of', 'outgoing', 'Show callees'],
        outgoing: ['Callees of', 'incoming', 'Show callers'],
        supertypes: ['Supertypes of', 'subtypes', 'Show subtypes'],
        subtypes: ['Subtypes of', 'supertypes', 'Show supertypes']
      }
      const [title, other, label] = labels[dir]
      return {
        title: `${title} ${items[0]?.name ?? ''}`,
        nodes: items.map((i) => nodeOf(doc.uri, i, () => childrenOf(doc.uri, i))),
        toggle: { label, load: async () => build(other) }
      }
    }
    deps.showHierarchy(build(direction))
  }

  async function workspaceSymbols(query: string): Promise<SymbolHit[]> {
    const root = deps.getRoot()
    if (!root || !query.trim()) return []
    const answers = await window.forge.lspWorkspace(root, 'workspace/symbol', { query })
    const out: SymbolHit[] = []
    for (const a of answers) {
      if (a.error) {
        deps.report(`Symbol search (${a.server}): ${a.error}`, true)
        continue
      }
      for (const s of (a.result as (SymbolInformation | WorkspaceSymbol)[] | null) ?? []) {
        const loc = s.location as { uri: string; range?: LspRange }
        out.push({
          name: s.name,
          kind: s.kind,
          container: s.containerName,
          path: monaco.Uri.parse(loc.uri).fsPath,
          line: (loc.range?.start.line ?? 0) + 1,
          column: (loc.range?.start.character ?? 0) + 1
        })
      }
    }
    return out
  }

  async function willRename(files: { from: string; to: string }[]): Promise<number> {
    const root = deps.getRoot()
    if (!root) return 0
    const answers = await window.forge.lspWorkspace(root, 'workspace/willRenameFiles', {
      files: files.map((f) => ({ oldUri: monaco.Uri.file(f.from).toString(), newUri: monaco.Uri.file(f.to).toString() }))
    })
    let edits = 0
    for (const a of answers) {
      // A server that does not do this (python, clangd ...) says so; that is not a problem.
      if (a.error) {
        if (/unhandled method|method not found|not supported/i.test(a.error)) continue
        deps.report(`Updating references (${a.server}): ${a.error}`, true)
        continue
      }
      if (a.result) edits += (await applyWorkspaceEdit(a.result as WorkspaceEdit, { getModel: deps.getModel })).edits
    }
    return edits
  }

  deps.editor.addAction({
    id: 'forge.goImplementation',
    label: 'Go to Implementation',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyB],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.3,
    run: safe('Go to Implementation', () => gotoKind('textDocument/implementation', 'implementationProvider', 'implementation'))
  })
  deps.editor.addAction({
    id: 'forge.goTypeDefinition',
    label: 'Go to Type Definition',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyB],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.4,
    run: safe('Go to Type Definition', () => gotoKind('textDocument/typeDefinition', 'typeDefinitionProvider', 'type definition'))
  })
  deps.editor.addAction({
    id: 'forge.organizeImports',
    label: 'Optimize Imports',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyO],
    contextMenuGroupId: '1_modification',
    contextMenuOrder: 1.3,
    run: safe('Optimize Imports', organizeImports)
  })
  deps.editor.addAction({
    id: 'forge.callHierarchy',
    label: 'Call Hierarchy',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyH],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.7,
    run: safe('Call Hierarchy', () => hierarchy('call', 'incoming'))
  })
  deps.editor.addAction({
    id: 'forge.typeHierarchy',
    label: 'Type Hierarchy',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.8,
    run: safe('Type Hierarchy', () => hierarchy('type', 'supertypes'))
  })
  // JetBrains-style keys for things Monaco already does.
  const act = (id: string): (() => void) => () => void deps.editor.getAction(id)?.run()
  deps.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, act('editor.action.revealDefinition')) // Go to Declaration
  deps.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI, act('editor.action.peekDefinition')) // Quick Definition
  deps.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyQ, act('editor.action.showHover')) // Quick Documentation
  deps.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, act('editor.action.triggerParameterHints')) // Parameter Info
  deps.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyT, act('editor.action.refactor')) // Refactor This
  deps.editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, act('editor.action.quickFix')) // Show Intention Actions

  deps.editor.addAction({
    id: 'forge.rename',
    label: 'Rename Symbol…',
    keybindings: [monaco.KeyCode.F2, monaco.KeyMod.Shift | monaco.KeyCode.F6],
    contextMenuGroupId: '1_modification',
    contextMenuOrder: 1.1,
    run: safe('Rename', renameSymbol)
  })
  deps.editor.addAction({
    id: 'forge.reformat',
    label: 'Reformat Code',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyL],
    contextMenuGroupId: '1_modification',
    contextMenuOrder: 1.2,
    run: (ed) => {
      const hasSelection = !ed.getSelection()?.isEmpty()
      return ed.getAction(hasSelection ? 'editor.action.formatSelection' : 'editor.action.formatDocument')?.run()
    }
  })

  // Quick fixes and other code actions (Ctrl+.). The server's raw diagnostics are used as context, because
  // servers match fixes on their own diagnostic codes.
  const overlaps = (a: LspRange, b: LspRange): boolean =>
    !(a.end.line < b.start.line || (a.end.line === b.start.line && a.end.character < b.start.character) ||
      b.end.line < a.start.line || (b.end.line === a.start.line && b.end.character < a.start.character))

  monaco.languages.registerCodeActionProvider(LANGUAGES, {
    async provideCodeActions(model, range, context) {
      const none = { actions: [], dispose: () => undefined }
      if (!(await capabilities(model))?.codeActionProvider) return none
      const doc = docs.get(keyOf(model.uri))
      if (!doc) return none
      const lspRange = toMonacoRange(range)
      const res = await request<(CodeAction | Command)[]>(model, 'textDocument/codeAction', {
        range: lspRange,
        context: {
          diagnostics: doc.diagnostics.filter((d) => overlaps(d.range, lspRange)),
          only: context.only ? [context.only] : undefined,
          triggerKind: context.trigger
        }
      })
      const actions = (res ?? []).map((item): monaco.languages.CodeAction => {
        // The protocol allows a bare Command here; treat it as an action that only runs that command.
        const action: CodeAction = typeof (item as Command).command === 'string' ? { title: item.title, command: item as Command } : (item as CodeAction)
        return {
          title: action.title,
          kind: action.kind,
          isPreferred: action.isPreferred,
          command: { id: 'forge.applyCodeAction', title: action.title, arguments: [doc.uri, action] }
        }
      })
      return { actions, dispose: () => undefined }
    }
  })

  monaco.editor.registerCommand('forge.applyCodeAction', (_accessor, uri: string, action: CodeAction) =>
    safe(`Quick fix "${action.title}"`, () => applyCodeAction(uri, action))()
  )

  // A server can also push edits itself (workspace/applyEdit), e.g. after running a command.
  window.forge.onLspApplyEdit((id, edit) => {
    applyWorkspaceEdit(edit as WorkspaceEdit, { getModel: deps.getModel }).then(
      () => void window.forge.lspApplyEditResult(id, true),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        deps.report(`Applying a server edit failed: ${message}`, true)
        void window.forge.lspApplyEditResult(id, false, message)
      }
    )
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

  return {
    openDoc,
    closeDoc,
    documentSymbols,
    workspaceSymbols,
    willRename,
    async quietFormat(fn) {
      quietFormat = true
      try {
        return await fn()
      } finally {
        quietFormat = false
      }
    }
  }
}
