// A trigram index over the text of the project's files: finding where a string occurs without reading every file.
// Every run of three characters in a file is recorded (lower-cased); a query keeps only the files that contain all of the
// query's trigrams, and only those are read and checked for the real match. Held in memory; rebuilt when a project opens.
// The same pass also counts the identifiers in each file, so words can be completed from the whole project, and trains a small
// local language model (ngram.ts) that finishes the line you are typing.

import { LocalModel, type ModelStats, type Suggestion } from './ngram'

export const MIN_QUERY = 3
export const MAX_INDEXED_BYTES = 512 * 1024
export const MIN_WORD_PREFIX = 2
const WORD = /[A-Za-z_$][\w$]{2,63}/g

export interface WordHit {
  word: string
  /** How often it occurs in the project. */
  count: number
}

export interface TextHit {
  path: string
  /** 1-based. */
  line: number
  text: string
}

/** Why a file is not in the index (not an error: binaries and huge files are simply not searchable text). */
export type SkipReason = 'binary' | 'too-large'

export class TextIndex {
  private readonly ids = new Map<string, number>()
  private readonly paths: (string | null)[] = []
  private readonly grams = new Map<string, Set<number>>()
  private readonly gramsOf = new Map<number, string[]>()
  private readonly wordsOf = new Map<number, Map<string, number>>()
  private readonly totals = new Map<string, number>()
  private readonly byPrefix = new Map<string, Set<string>>()
  private readonly model = new LocalModel()

  get size(): number {
    return this.gramsOf.size
  }

  has(path: string): boolean {
    const id = this.ids.get(path)
    return id !== undefined && this.gramsOf.has(id)
  }

  /** Replaces whatever was indexed for `path`. Returns why the file was left out, or null when it was indexed. */
  add(path: string, text: string): SkipReason | null {
    this.remove(path)
    if (text.length > MAX_INDEXED_BYTES) return 'too-large'
    if (text.slice(0, 8192).includes('\0')) return 'binary'
    let id = this.ids.get(path)
    if (id === undefined) {
      id = this.paths.length
      this.paths.push(path)
      this.ids.set(path, id)
    }
    const lower = text.toLowerCase()
    const mine = new Set<string>()
    for (let i = 0; i + MIN_QUERY <= lower.length; i++) mine.add(lower.slice(i, i + MIN_QUERY))
    for (const g of mine) {
      let set = this.grams.get(g)
      if (!set) this.grams.set(g, (set = new Set()))
      set.add(id)
    }
    this.gramsOf.set(id, [...mine])
    const counts = new Map<string, number>()
    for (const w of text.match(WORD) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1)
    this.wordsOf.set(id, counts)
    this.model.train(path, text)
    for (const [w, c] of counts) {
      const before = this.totals.get(w) ?? 0
      this.totals.set(w, before + c)
      if (before === 0) this.prefixSet(w, true)
    }
    return null
  }

  private prefixSet(word: string, add: boolean): void {
    const key = word.slice(0, MIN_WORD_PREFIX).toLowerCase()
    let set = this.byPrefix.get(key)
    if (add) {
      if (!set) this.byPrefix.set(key, (set = new Set()))
      set.add(word)
    } else if (set) {
      set.delete(word)
      if (set.size === 0) this.byPrefix.delete(key)
    }
  }

  remove(path: string): void {
    this.model.forget(path)
    const id = this.ids.get(path)
    if (id === undefined) return
    for (const g of this.gramsOf.get(id) ?? []) {
      const set = this.grams.get(g)
      set?.delete(id)
      if (set?.size === 0) this.grams.delete(g)
    }
    this.gramsOf.delete(id)
    for (const [w, c] of this.wordsOf.get(id) ?? []) {
      const left = (this.totals.get(w) ?? 0) - c
      if (left > 0) this.totals.set(w, left)
      else {
        this.totals.delete(w)
        this.prefixSet(w, false)
      }
    }
    this.wordsOf.delete(id)
  }

  /** The rest of the line being typed, from the model trained on this project. */
  suggestLine(path: string, before: string): Suggestion | null {
    return this.model.suggest(path, before)
  }

  modelStats(): ModelStats {
    return this.model.stats()
  }

  /** Removes `path` and everything beneath it (a deleted folder). */
  removeTree(path: string, sep: string): void {
    const prefix = path + sep
    for (const [p] of this.ids) if (p === path || p.startsWith(prefix)) this.remove(p)
  }

  /**
   * Identifiers of the project that start with `prefix` (case-insensitive), best first: those that also match the case you
   * typed, then the most frequent, then the shortest. The word you typed is not offered back to you.
   */
  complete(prefix: string, limit: number): WordHit[] {
    if (prefix.length < MIN_WORD_PREFIX) throw new Error(`Type at least ${MIN_WORD_PREFIX} characters to complete a word`)
    const lower = prefix.toLowerCase()
    const out: (WordHit & { exact: boolean })[] = []
    for (const w of this.byPrefix.get(lower.slice(0, MIN_WORD_PREFIX)) ?? []) {
      if (w === prefix || !w.toLowerCase().startsWith(lower)) continue
      out.push({ word: w, count: this.totals.get(w) ?? 0, exact: w.startsWith(prefix) })
    }
    out.sort((a, b) => Number(b.exact) - Number(a.exact) || b.count - a.count || a.word.length - b.word.length || a.word.localeCompare(b.word))
    return out.slice(0, limit).map(({ word, count }) => ({ word, count }))
  }

  /** The indexed files whose text may contain `query`: every query trigram is present, so the real check can follow. */
  candidates(query: string): string[] {
    const q = query.toLowerCase()
    if (q.length < MIN_QUERY) throw new Error(`Type at least ${MIN_QUERY} characters to search the text of the project`)
    const sets: Set<number>[] = []
    for (let i = 0; i + MIN_QUERY <= q.length; i++) {
      const set = this.grams.get(q.slice(i, i + MIN_QUERY))
      if (!set) return [] // a trigram no file has: nothing can match
      sets.push(set)
    }
    sets.sort((a, b) => a.size - b.size)
    const [first, ...rest] = sets
    const out: string[] = []
    for (const id of first ?? []) {
      if (rest.every((s) => s.has(id))) {
        const p = this.paths[id]
        if (p) out.push(p)
      }
    }
    return out.sort()
  }

  /**
   * Lines containing `query` (case-insensitive), at most `limit`. `read` supplies a file's current text; a file that can no
   * longer be read (deleted since it was indexed) is skipped, since the watcher is about to drop it.
   */
  async search(query: string, limit: number, read: (path: string) => Promise<string>): Promise<TextHit[]> {
    const q = query.toLowerCase()
    const hits: TextHit[] = []
    for (const path of this.candidates(query)) {
      let text: string
      try {
        text = await read(path)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw err
      }
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        if (!(lines[i] ?? '').toLowerCase().includes(q)) continue
        hits.push({ path, line: i + 1, text: (lines[i] ?? '').trim().slice(0, 300) })
        if (hits.length >= limit) return hits
      }
    }
    return hits
  }
}
