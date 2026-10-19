import * as monaco from 'monaco-editor'
import nspell from 'nspell'
import { settings } from './settings'

// Typo checking: misspelled words in comments, strings and prose files (Markdown, plain text, HTML text) get a blue squiggle,
// and Quick Fix (Ctrl+.) offers corrections, "Add to dictionary" and "Ignore". English only. To keep it quiet, a word that is
// used as an identifier in the same file is never reported when it appears in a comment, camelCase and snake_case words are
// split into their parts, and short words, ALL-CAPS words, URLs and hex colors are skipped.

export interface Word {
  word: string
  /** Offsets in the text that was checked. */
  start: number
  end: number
}

const MIN_LENGTH = 4
const MAX_CHARS = 150_000
const MAX_MARKERS = 200
const OWNER = 'spell'

/** URLs, e-mail addresses and hex numbers are not words: blank them out, keeping every offset where it was. */
const blank = (text: string): string => text.replace(/https?:\/\/\S+|\S+@\S+\.\S+|\b0x[0-9a-f]+\b|#[0-9a-f]{3,8}\b/gi, (m) => ' '.repeat(m.length))

/** The words of a piece of text, with camelCase and snake_case split into parts. Contractions ("don't") stay whole. */
export function wordsIn(text: string, base = 0): Word[] {
  const out: Word[] = []
  const clean = blank(text)
  for (const run of clean.matchAll(/[A-Za-z]+(?:'[a-z]+)?/g)) {
    const raw = run[0]
    const at = run.index ?? 0
    if (raw.includes("'")) {
      out.push({ word: raw, start: base + at, end: base + at + raw.length })
      continue
    }
    for (const part of raw.matchAll(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g)) {
      const p = part[0]
      const s = at + (part.index ?? 0)
      out.push({ word: p, start: base + s, end: base + s + p.length })
    }
  }
  return out
}

/** Languages whose plain (untokenized) text is prose. */
const PROSE_LANGS = new Set(['markdown', 'plaintext', 'html', 'xml', 'handlebars', 'razor', 'restructuredtext'])

/** Fenced code blocks and inline code of a Markdown text, blanked out so they are not checked. */
const withoutCode = (text: string): string => text.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => m.replace(/[^\n]/g, ' '))

interface Ranges {
  /** The stretches of text to check (comments, strings, prose). */
  prose: [number, number][]
  /** Words that are code (identifiers); these are known, not typos. */
  codeWords: Set<string>
}

function rangesOf(model: monaco.editor.ITextModel, text: string): Ranges | null {
  const lang = model.getLanguageId()
  if (lang === 'plaintext' || lang === 'restructuredtext') return { prose: [[0, text.length]], codeWords: new Set() }
  if (lang === 'markdown') {
    const masked = withoutCode(text)
    return { prose: [[0, masked.length]], codeWords: new Set() }
  }
  let lines: monaco.Token[][]
  try {
    lines = monaco.editor.tokenize(text, lang)
  } catch {
    return null
  }
  const prose: [number, number][] = []
  const codeWords = new Set<string>()
  const textLines = text.split('\n')
  let lineStart = 0
  lines.forEach((tokens, li) => {
    const line = (textLines[li] ?? '').replace(/\r$/, '')
    tokens.forEach((tok, ti) => {
      const from = tok.offset
      const to = tokens[ti + 1]?.offset ?? line.length
      if (to <= from) return
      const type = tok.type
      const isProse = type.includes('comment') || (type.includes('string') && !type.includes('escape') && !type.includes('key')) || (PROSE_LANGS.has(lang) && type === '')
      if (isProse) prose.push([lineStart + from, lineStart + to])
      else for (const w of wordsIn(line.slice(from, to))) codeWords.add(w.word.toLowerCase())
    })
    lineStart += (textLines[li] ?? '').length + 1
  })
  return { prose, codeWords }
}

export function initSpell(): void {
  let speller: ReturnType<typeof nspell> | null = null
  let loading: Promise<ReturnType<typeof nspell>> | null = null
  const ignored = new Set<string>() // for this session
  const verdicts = new Map<string, boolean>() // word (lowercase) -> spelled correctly

  const dictionary = (): Promise<ReturnType<typeof nspell>> => {
    loading ??= window.forge.spellDictionary().then((d) => (speller = nspell({ aff: d.aff, dic: d.dic })))
    return loading
  }
  const userWords = (): string[] => settings.getJson<string[]>('spellWords', [])

  const isKnown = (s: ReturnType<typeof nspell>, word: string): boolean => {
    const lower = word.toLowerCase()
    const cached = verdicts.get(lower)
    if (cached !== undefined) return cached
    const ok = ignored.has(lower) || userWords().includes(lower) || s.correct(word) || s.correct(lower)
    verdicts.set(lower, ok)
    return ok
  }

  async function check(model: monaco.editor.ITextModel): Promise<void> {
    if (model.isDisposed()) return
    if (!settings.get<boolean>('spellcheck') || model.uri.scheme !== 'file' || model.getValueLength() > MAX_CHARS) {
      monaco.editor.setModelMarkers(model, OWNER, [])
      return
    }
    const s = await dictionary()
    if (model.isDisposed()) return
    const text = model.getValue()
    const ranges = rangesOf(model, text)
    if (!ranges) return
    const source = model.getLanguageId() === 'markdown' ? withoutCode(text) : text
    const markers: monaco.editor.IMarkerData[] = []
    for (const [from, to] of ranges.prose) {
      for (const w of wordsIn(source.slice(from, to), from)) {
        if (markers.length >= MAX_MARKERS) break
        if (w.word.length < MIN_LENGTH || w.word === w.word.toUpperCase()) continue
        if (ranges.codeWords.has(w.word.toLowerCase()) || isKnown(s, w.word)) continue
        const a = model.getPositionAt(w.start)
        const b = model.getPositionAt(w.end)
        markers.push({
          severity: monaco.MarkerSeverity.Info,
          message: `Typo: "${w.word}"`,
          source: 'spell',
          code: 'typo',
          startLineNumber: a.lineNumber,
          startColumn: a.column,
          endLineNumber: b.lineNumber,
          endColumn: b.column
        })
      }
    }
    monaco.editor.setModelMarkers(model, OWNER, markers)
  }

  // Check a file shortly after it stops changing.
  const timers = new WeakMap<monaco.editor.ITextModel, number>()
  const later = (model: monaco.editor.ITextModel): void => {
    window.clearTimeout(timers.get(model))
    timers.set(
      model,
      window.setTimeout(() => void check(model).catch(() => undefined), 700) // a failed dictionary load must not break typing
    )
  }
  const watch = (model: monaco.editor.ITextModel): void => {
    if (model.uri.scheme !== 'file') return
    model.onDidChangeContent(() => later(model))
    model.onDidChangeLanguage(() => later(model))
    later(model)
  }
  monaco.editor.getModels().forEach(watch)
  monaco.editor.onDidCreateModel(watch)
  settings.onChange((key) => {
    if (key === 'spellcheck' || key === 'spellWords') {
      verdicts.clear()
      monaco.editor.getModels().forEach(later)
    }
  })

  // ---- quick fixes ----
  const recase = (original: string, suggestion: string): string =>
    original === original.toUpperCase() ? suggestion.toUpperCase() : original[0] === original[0]?.toUpperCase() ? suggestion[0]?.toUpperCase() + suggestion.slice(1) : suggestion

  monaco.languages.registerCodeActionProvider('*', {
    provideCodeActions(model, _range, context) {
      const actions: monaco.languages.CodeAction[] = []
      for (const m of context.markers) {
        if (m.source !== 'spell' || !speller) continue
        const range = { startLineNumber: m.startLineNumber, startColumn: m.startColumn, endLineNumber: m.endLineNumber, endColumn: m.endColumn }
        const word = model.getValueInRange(range)
        speller.suggest(word).slice(0, 5).forEach((suggestion, i) => {
          actions.push({
            title: `Change to "${recase(word, suggestion)}"`,
            kind: 'quickfix',
            diagnostics: [m],
            isPreferred: i === 0,
            edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range, text: recase(word, suggestion) } }] }
          })
        })
        actions.push({ title: `Add "${word}" to dictionary`, kind: 'quickfix', diagnostics: [m], command: { id: 'forge.spell.add', title: 'Add to dictionary', arguments: [word] } })
        actions.push({ title: `Ignore "${word}" for now`, kind: 'quickfix', diagnostics: [m], command: { id: 'forge.spell.ignore', title: 'Ignore', arguments: [word] } })
      }
      return { actions, dispose: () => undefined }
    }
  })
  monaco.editor.registerCommand('forge.spell.add', (_accessor, word: string) => {
    const lower = word.toLowerCase()
    if (!userWords().includes(lower)) settings.setJson('spellWords', [...userWords(), lower].sort())
  })
  monaco.editor.registerCommand('forge.spell.ignore', (_accessor, word: string) => {
    ignored.add(word.toLowerCase())
    verdicts.clear()
    monaco.editor.getModels().forEach(later)
  })
}

/** The word at the cursor of an editor, or null. */
export function wordAtCursor(editor: monaco.editor.IStandaloneCodeEditor): string | null {
  const model = editor.getModel()
  const pos = editor.getPosition()
  if (!model || !pos) return null
  return model.getWordAtPosition(pos)?.word ?? null
}

/** Adds a word to the user's dictionary (the same as the Quick Fix). */
export function addToDictionary(word: string): void {
  const lower = word.toLowerCase()
  const words = settings.getJson<string[]>('spellWords', [])
  if (!words.includes(lower)) settings.setJson('spellWords', [...words, lower].sort())
}
