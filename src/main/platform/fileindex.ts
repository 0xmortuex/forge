import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, join, sep } from 'node:path'
import { walkFiles } from '../walk'
import { TextIndex, type SkipReason, type TextHit } from './textindex'

// A persistent list of the project's files, kept current from the file watcher. A snapshot on disk makes the next
// start answer queries immediately while a rescan reconciles anything that changed while Forge was closed. Alongside it
// lives an in-memory trigram index of the files' text (see textindex.ts), built in the background after each scan.

export type IndexState = 'idle' | 'indexing' | 'ready'

export interface IndexHit {
  path: string
  score: number
}

export interface FileIndexApi {
  /** Loads the snapshot (if any), then rescans the project. Resolves when the index is ready. */
  open(root: string): Promise<{ files: number }>
  state(): IndexState
  query(text: string, limit?: number): IndexHit[]
  /** Every indexed file, in the order the scan found them. */
  list(): string[]
  /** Lines containing the text (at least 3 characters), case-insensitive. Waits for the text index to be built. */
  searchText(text: string, limit?: number): Promise<TextHit[]>
  /** How much of the project is searchable as text, and which files are not (binary, too large, unreadable). */
  textStats(): { files: number; building: boolean; skipped: { path: string; reason: string }[] }
  /** Paths reported by the file watcher; `all` means events were lost and everything must be re-checked. */
  changed(paths: string[], all?: boolean): Promise<void>
}

const SNAPSHOT_VERSION = 1
interface Snapshot {
  version: number
  root: string
  files: string[]
}

export interface FileIndexOptions {
  /** Where the snapshot lives; without it the index is memory-only. */
  snapshotPath?: string | ((root: string) => string)
  walk?: (root: string, onFile: (path: string) => void) => Promise<void>
  onState?: (state: IndexState) => void
  /** Reads a file's text for the text index; defaults to UTF-8 from disk. */
  readText?: (path: string) => Promise<string>
}

export class FileIndex implements FileIndexApi {
  private root = ''
  private files = new Set<string>()
  private status: IndexState = 'idle'
  private text = new TextIndex()
  private textBuild: Promise<void> = Promise.resolve()
  private building = false
  private generation = 0
  private dirty = new Set<string>()
  private skipped = new Map<string, SkipReason | string>()

  constructor(private readonly opts: FileIndexOptions = {}) {}

  private snapshotFile(): string | undefined {
    const p = this.opts.snapshotPath
    return typeof p === 'function' ? p(this.root) : p
  }

  state(): IndexState {
    return this.status
  }

  private setState(s: IndexState): void {
    this.status = s
    this.opts.onState?.(s)
  }

  /** Resolves when the scan in progress (if any) is over, however it ended; searchText waits for it. */
  private scan: Promise<void> = Promise.resolve()

  open(root: string): Promise<{ files: number }> {
    this.root = root
    this.files = new Set()
    this.generation++ // a text index build for the previous project must not land in this one
    this.text = new TextIndex()
    this.skipped = new Map()
    this.dirty = new Set()
    this.building = false
    this.setState('indexing')
    const run = (async () => {
      const cached = await this.readSnapshot(root)
      if (cached) this.files = new Set(cached.files.map((rel) => join(root, rel)))
      await this.doRescan()
      return { files: this.files.size }
    })()
    this.scan = run.then(() => undefined, () => undefined)
    return run
  }

  private async readSnapshot(root: string): Promise<Snapshot | null> {
    const path = this.snapshotFile()
    if (!path) return null
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
    let snap: Snapshot
    try {
      snap = JSON.parse(raw) as Snapshot
    } catch (err) {
      throw new Error(`Index snapshot ${path} is corrupt (${(err as Error).message}); delete it to rebuild`)
    }
    if (snap.version !== SNAPSHOT_VERSION) throw new Error(`Index snapshot ${path} has version ${snap.version}, expected ${SNAPSHOT_VERSION}; delete it to rebuild`)
    // A snapshot of another project is simply not ours; it gets overwritten by the rescan below.
    return snap.root === root ? snap : null
  }

  /** A rescan on its own (events were lost): tracked so that searchText waits for it. */
  private rescan(): Promise<void> {
    const run = this.doRescan()
    this.scan = run.then(() => undefined, () => undefined)
    return run
  }

  private async doRescan(): Promise<void> {
    this.setState('indexing')
    const fresh = new Set<string>()
    await (this.opts.walk ?? walkFiles)(this.root, (p) => void fresh.add(p))
    this.files = fresh
    await this.writeSnapshot()
    this.setState('ready')
    const build = this.buildText(++this.generation)
    build.catch(() => undefined) // not unhandled: searchText awaits this promise and reports a failure itself
    this.textBuild = build
  }

  private readText(path: string): Promise<string> {
    return (this.opts.readText ?? ((p: string) => readFile(p, 'utf8')))(path)
  }

  private async indexTextOf(ix: TextIndex, path: string): Promise<void> {
    let text: string
    try {
      text = await this.readText(path)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      ix.remove(path)
      if (code === 'ENOENT') this.skipped.delete(path) // gone; the watcher drops it from the file list
      else this.skipped.set(path, `unreadable (${code ?? (err as Error).message})`)
      return
    }
    const why = ix.add(path, text)
    if (why) this.skipped.set(path, why)
    else this.skipped.delete(path)
  }

  private async buildText(gen: number): Promise<void> {
    this.building = true
    this.dirty = new Set()
    this.skipped = new Map()
    const ix = new TextIndex()
    const queue = [...this.files]
    const worker = async (): Promise<void> => {
      for (let p = queue.pop(); p !== undefined; p = queue.pop()) {
        if (gen !== this.generation) return // a newer scan replaced this one
        await this.indexTextOf(ix, p)
      }
    }
    await Promise.all(Array.from({ length: 16 }, worker))
    if (gen !== this.generation) return
    // Files that changed while this build was running may have been read before the change.
    for (const p of this.dirty) await this.indexTextOf(ix, p)
    this.dirty.clear()
    this.text = ix
    this.building = false
  }

  async searchText(text: string, limit = 100): Promise<TextHit[]> {
    if (!this.root) throw new Error('The index has no project open')
    await this.scan
    await this.textBuild
    return this.text.search(text, limit, (p) => this.readText(p))
  }

  textStats(): { files: number; building: boolean; skipped: { path: string; reason: string }[] } {
    return { files: this.text.size, building: this.building, skipped: [...this.skipped].map(([path, reason]) => ({ path, reason })) }
  }

  private writing: Promise<void> = Promise.resolve()

  /** Writes are queued: concurrent ones would share the temporary file and clobber each other. */
  private writeSnapshot(): Promise<void> {
    const run = this.writing.then(() => this.doWriteSnapshot())
    this.writing = run.catch(() => undefined) // keeps the queue alive; the caller still gets the error from `run`
    return run
  }

  private async doWriteSnapshot(): Promise<void> {
    const path = this.snapshotFile()
    if (!path) return
    const snap: Snapshot = { version: SNAPSHOT_VERSION, root: this.root, files: [...this.files].map((f) => relative(this.root, f)) }
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    await writeFile(tmp, JSON.stringify(snap), 'utf8')
    await rename(tmp, path)
  }

  async changed(paths: string[], all = false): Promise<void> {
    if (!this.root) throw new Error('The index has no project open')
    if (all) return this.rescan()
    let touched = false
    for (const p of paths) {
      let kind: 'file' | 'dir' | 'gone'
      try {
        kind = (await stat(p)).isDirectory() ? 'dir' : 'file'
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        kind = 'gone'
      }
      if (kind === 'file') {
        if (!this.files.has(p)) touched = true
        this.files.add(p)
        if (this.building) this.dirty.add(p)
        await this.indexTextOf(this.text, p)
      } else if (kind === 'gone') {
        this.text.removeTree(p, sep)
        for (const k of [...this.skipped.keys()]) if (k === p || k.startsWith(p + sep)) this.skipped.delete(k)
        // The path may have been a file or a whole folder: drop it and everything beneath it.
        const prefix = p + sep
        for (const f of [...this.files]) {
          if (f === p || f.startsWith(prefix)) {
            this.files.delete(f)
            touched = true
          }
        }
      }
      // A directory that changed says nothing about its contents; the watcher reports the files inside separately.
    }
    if (touched) await this.writeSnapshot()
  }

  list(): string[] {
    return [...this.files]
  }

  query(text: string, limit = 50): IndexHit[] {
    const q = text.trim().toLowerCase()
    const hits: IndexHit[] = []
    for (const path of this.files) {
      const score = scorePath(path.slice(this.root.length + 1), q)
      if (score > 0) hits.push({ path, score })
    }
    hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    return hits.slice(0, limit)
  }
}

/** 0 means no match. The file name counts for much more than the folders in front of it. */
export function scorePath(rel: string, q: string): number {
  if (!q) return 1
  const lower = rel.toLowerCase()
  const slash = Math.max(lower.lastIndexOf('/'), lower.lastIndexOf('\\'))
  const name = lower.slice(slash + 1)
  if (name === q) return 1000
  if (name.startsWith(q)) return 800 - Math.min(name.length - q.length, 100)
  const at = name.indexOf(q)
  if (at >= 0) return 600 - Math.min(at, 100)
  const inName = subsequenceGaps(name, q)
  if (inName >= 0) return 400 - Math.min(inName, 100)
  const inPath = subsequenceGaps(lower, q)
  return inPath >= 0 ? 200 - Math.min(inPath, 100) : 0
}

/** The number of skipped characters when `q` is found in order inside `s`, or -1 when it is not. */
function subsequenceGaps(s: string, q: string): number {
  let i = 0
  let gaps = 0
  let last = -1
  for (const ch of q) {
    const at = s.indexOf(ch, i)
    if (at < 0) return -1
    if (last >= 0) gaps += at - last - 1
    last = at
    i = at + 1
  }
  return gaps
}
