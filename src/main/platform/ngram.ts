// A small language model for code, trained on the project's own files, on this computer: it finishes the line you are typing.
// It is a statistical n-gram model (what usually follows the last one to three symbols), not a neural network, and it knows
// only your project. Per language family, so Python code never suggests TypeScript. The notes' "Full Line" is the model-based
// counterpart (a bundled neural model in a separate process); this is the local, dependency-free one.

export const ORDER = 3 // symbols of context
export const MAX_FILE_CHARS = 200_000
export const MAX_TOTAL_SYMBOLS = 5_000_000
export const MAX_OUTPUT_SYMBOLS = 14
/** A context must have been seen at least this often before it is trusted. */
export const MIN_SUPPORT = 2
/** The first symbol must be at least this likely, and every further one at least STEP_MIN (generation stops at a doubt). */
export const FIRST_MIN = 0.5
export const STEP_MIN = 0.35
/** Shorter contexts are worth less: every step of backoff multiplies the probability by this. */
const BACKOFF = 0.8
const NEWLINE = '\n'
/** Stands for something that cannot be reproduced (a very long string): it ends a suggestion instead of appearing in one. */
const PLACEHOLDER = '\u0000'

// ---------------------------------------------------------------- symbols

const OPERATORS = ['...', '===', '!==', '**=', '<<=', '>>=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '++', '--', '+=', '-=', '*=', '/=', '%=', '::', '->', '**', '<<', '>>']
const IDENT = /^[A-Za-z_$][\w$]*/
const NUMBER = /^\d[\w.]*/
const MAX_LITERAL = 60

/** One line's symbols (indentation dropped, each symbol carries a leading space if there was whitespace before it). */
function lineSymbols(line: string): { symbols: string[]; open: boolean } {
  const out: string[] = []
  let i = 0
  let space = false
  let open = false // the line ends inside an unterminated string
  const push = (s: string): void => void out.push((space ? ' ' : '') + s)
  while (i < line.length) {
    const rest = line.slice(i)
    const ch = line[i] as string
    if (ch === ' ' || ch === '\t') {
      if (out.length) space = true
      i++
      continue
    }
    let tok: string | undefined
    if ((tok = IDENT.exec(rest)?.[0] ?? NUMBER.exec(rest)?.[0])) {
      push(tok)
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1
      const closed = j < line.length
      tok = line.slice(i, closed ? j + 1 : line.length)
      if (!closed) open = true
      if (closed && tok.length > MAX_LITERAL) {
        push(PLACEHOLDER)
      } else push(tok)
    } else {
      tok = OPERATORS.find((op) => rest.startsWith(op)) ?? ch
      push(tok)
    }
    i += tok.length
    space = false
  }
  return { symbols: out, open }
}

/** Every line of a file as symbols, each non-empty line ended by a newline symbol. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const { symbols } = lineSymbols(line)
    if (!symbols.length) continue
    out.push(...symbols, NEWLINE)
  }
  return out
}

interface Prefix {
  /** The symbols before the word being typed. */
  context: string[]
  /** The word (or unterminated string) being typed, with its leading space if it has one; null when the text ends after a symbol. */
  partial: string | null
  /** The text ends in whitespace: the next symbol's own leading space is already typed. */
  trailingSpace: boolean
}

/** The text before the cursor, which sits at the end of a line. */
export function parsePrefix(before: string): Prefix {
  const lines = before.split(/\r?\n/)
  const last = lines.pop() ?? ''
  const context = tokenize(lines.join('\n'))
  const { symbols, open } = lineSymbols(last)
  const trailingSpace = /[ \t]$/.test(last) && last.trim().length > 0
  let partial: string | null = null
  const tail = symbols[symbols.length - 1]
  if (!trailingSpace && tail !== undefined && (open || /[\w$]$/.test(tail))) partial = symbols.pop() ?? null
  context.push(...symbols)
  return { context, partial, trailingSpace }
}

// ---------------------------------------------------------------- families

const FAMILIES: Record<string, string[]> = {
  js: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'],
  py: ['py', 'pyw'],
  java: ['java'],
  kt: ['kt', 'kts'],
  c: ['c', 'h'],
  cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hh'],
  css: ['css', 'scss', 'less'],
  html: ['html', 'htm', 'vue', 'svelte']
}
const FAMILY_OF = new Map<string, string>(Object.entries(FAMILIES).flatMap(([family, exts]) => exts.map((e) => [e, family] as const)))

/** Languages that share habits share a model (TypeScript and JavaScript); everything else is its own. */
export function familyOf(path: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  return FAMILY_OF.get(ext) ?? (ext || 'text')
}

// ---------------------------------------------------------------- the model

export interface Suggestion {
  /** What to insert at the cursor. */
  text: string
  /** 0..1: how sure the model is of the weakest part it offers. */
  confidence: number
}

export type TrainResult = 'trained' | 'too-large' | 'model-full'

export interface ModelStats {
  files: number
  symbols: number
  contexts: number
}

export class LocalModel {
  private readonly ids = new Map<string, number>()
  private readonly names: string[] = []
  /** Per context length (1..ORDER): context key -> next symbol id -> count. */
  private readonly tables: Map<string, Map<number, number>>[] = Array.from({ length: ORDER + 1 }, () => new Map())
  private readonly totals: Map<string, number>[] = Array.from({ length: ORDER + 1 }, () => new Map())
  private readonly files = new Map<string, { family: string; symbols: Int32Array }>()
  private symbolCount = 0

  private id(sym: string): number {
    let n = this.ids.get(sym)
    if (n === undefined) {
      n = this.names.length
      this.names.push(sym)
      this.ids.set(sym, n)
    }
    return n
  }

  private key(family: string, ctx: ArrayLike<number>, from: number, to: number): string {
    let k = family
    for (let i = from; i < to; i++) k += ',' + ctx[i]
    return k
  }

  /** Learns from a file, replacing what it learned from an earlier version of the same file. */
  train(path: string, text: string): TrainResult {
    this.forget(path)
    if (text.length > MAX_FILE_CHARS) return 'too-large'
    const symbols = Int32Array.from(tokenize(text), (s) => this.id(s))
    if (this.symbolCount + symbols.length > MAX_TOTAL_SYMBOLS) return 'model-full'
    const family = familyOf(path)
    this.files.set(path, { family, symbols })
    this.symbolCount += symbols.length
    this.count(family, symbols, 1)
    return 'trained'
  }

  /** Takes back what a file taught the model (it was changed or deleted). */
  forget(path: string): void {
    const f = this.files.get(path)
    if (!f) return
    this.count(f.family, f.symbols, -1)
    this.symbolCount -= f.symbols.length
    this.files.delete(path)
  }

  private count(family: string, s: Int32Array, delta: 1 | -1): void {
    for (let i = 1; i < s.length; i++) {
      for (let k = 1; k <= ORDER && k <= i; k++) {
        const ctx = this.key(family, s, i - k, i)
        const next = s[i] as number
        const table = this.tables[k] as Map<string, Map<number, number>>
        const totals = this.totals[k] as Map<string, number>
        let row = table.get(ctx)
        if (!row) table.set(ctx, (row = new Map()))
        const n = (row.get(next) ?? 0) + delta
        if (n > 0) row.set(next, n)
        else row.delete(next)
        const total = (totals.get(ctx) ?? 0) + delta
        if (total > 0) totals.set(ctx, total)
        else {
          totals.delete(ctx)
          table.delete(ctx)
        }
      }
    }
  }

  stats(): ModelStats {
    return { files: this.files.size, symbols: this.symbolCount, contexts: this.tables.reduce((n, t) => n + t.size, 0) }
  }

  /** Candidates for the next symbol with their probabilities, from the longest context the model trusts. */
  private next(family: string, context: string[], accept: (sym: string) => boolean): { sym: string; p: number }[] {
    const known = context.map((s) => this.ids.get(s))
    for (let k = Math.min(ORDER, context.length), step = 0; k >= 1; k--, step++) {
      const slice = known.slice(context.length - k)
      if (slice.some((x) => x === undefined)) continue // a symbol the model has never seen cannot be a context
      const ctx = this.key(family, slice as number[], 0, k)
      const row = (this.tables[k] as Map<string, Map<number, number>>).get(ctx)
      const total = (this.totals[k] as Map<string, number>).get(ctx) ?? 0
      if (!row || total < MIN_SUPPORT) continue
      const matches = [...row].map(([id, n]) => ({ sym: this.names[id] as string, n })).filter((m) => accept(m.sym))
      const mass = matches.reduce((sum, m) => sum + m.n, 0)
      if (!matches.length) continue
      return matches
        .map((m) => ({ sym: m.sym, p: (m.n / mass) * BACKOFF ** step }))
        .sort((a, b) => b.p - a.p || (a.sym < b.sym ? -1 : 1))
    }
    return []
  }

  /** The rest of the current line, or null when the model is not sure enough to say anything. */
  suggest(path: string, before: string): Suggestion | null {
    const family = familyOf(path)
    const { context, partial, trailingSpace } = parsePrefix(before)
    if (!context.length) return null
    let out = ''
    let confidence = 1
    for (let n = 0; n < MAX_OUTPUT_SYMBOLS; n++) {
      const first = n === 0
      const accept = (sym: string): boolean => {
        if (sym.includes(PLACEHOLDER)) return false // a symbol that stands for something it cannot reproduce
        if (!first) return true
        if (partial !== null) return sym.startsWith(partial) && sym.length > partial.length
        if (trailingSpace) return sym.startsWith(' ')
        return true
      }
      const best = this.next(family, context, accept)[0]
      if (!best || best.p < (first ? FIRST_MIN : STEP_MIN) || best.sym === NEWLINE) break
      let text = best.sym
      if (first) {
        if (partial !== null) text = text.slice(partial.length)
        else if (trailingSpace) text = text.slice(1)
      }
      out += text
      confidence = Math.min(confidence, best.p)
      context.push(best.sym)
    }
    return out.trim() ? { text: out, confidence } : null
  }
}
