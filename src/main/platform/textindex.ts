// A trigram index over the text of the project's files: finding where a string occurs without reading every file.
// Every run of three characters in a file is recorded (lower-cased); a query keeps only the files that contain all of the
// query's trigrams, and only those are read and checked for the real match. Held in memory; rebuilt when a project opens.

export const MIN_QUERY = 3
export const MAX_INDEXED_BYTES = 512 * 1024

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
    return null
  }

  remove(path: string): void {
    const id = this.ids.get(path)
    if (id === undefined) return
    for (const g of this.gramsOf.get(id) ?? []) {
      const set = this.grams.get(g)
      set?.delete(id)
      if (set?.size === 0) this.grams.delete(g)
    }
    this.gramsOf.delete(id)
  }

  /** Removes `path` and everything beneath it (a deleted folder). */
  removeTree(path: string, sep: string): void {
    const prefix = path + sep
    for (const [p] of this.ids) if (p === path || p.startsWith(prefix)) this.remove(p)
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
