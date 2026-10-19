import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { Worker } from 'node:worker_threads'
import { ipcMain } from 'electron'

// The database viewer's engine: SQLite compiled to WebAssembly (sql.js), run in a worker thread so that a heavy or
// runaway query can be stopped instead of freezing the whole IDE. The file is loaded into memory and is READ-ONLY: SQLite
// itself refuses every write (PRAGMA query_only), and nothing is ever written back to the file on disk.

export interface DbColumn {
  name: string
  type: string
  pk: boolean
  notNull: boolean
}
export interface DbTable {
  name: string
  kind: 'table' | 'view'
  columns: DbColumn[]
  /** Number of rows; null for a view (counting could be as slow as the view itself). */
  rows: number | null
}
export interface DbSchema {
  tables: DbTable[]
  sqliteVersion: string
}
/** A cell: text, a number, NULL, or `{ blob }` for binary data (its length in bytes). */
export type DbCell = string | number | null | { blob: number }
export interface DbResult {
  columns: string[]
  rows: DbCell[][]
  /** True when there were more rows than the limit. */
  truncated: boolean
}
export interface DbQueryResult {
  results: DbResult[]
  ms: number
}

const MAX_FILE_BYTES = 256 * 1024 * 1024
const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 20000
const QUERY_TIMEOUT_MS = 30000
const SQLITE_MAGIC = 'SQLite format 3\0'

const nodeRequire = createRequire(__filename)

// The worker's code. It is plain CommonJS run with `eval`, so no extra build entry is needed.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const initSqlJs = require(workerData.sqlJsPath)
const ready = initSqlJs({ locateFile: (f) => workerData.distDir + '/' + f })
let db = null
const quote = (name) => '"' + String(name).replace(/"/g, '""') + '"'
const rows = (sql) => db.exec(sql)[0]?.values ?? []

function schema() {
  const tables = rows("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name").map(([name, type]) => ({
    name,
    kind: type,
    columns: rows('PRAGMA table_info(' + quote(name) + ')').map((c) => ({ name: c[1], type: c[2], notNull: c[3] === 1, pk: c[5] > 0 })),
    rows: type === 'table' ? rows('SELECT COUNT(*) FROM ' + quote(name))[0][0] : null
  }))
  return { tables, sqliteVersion: rows('SELECT sqlite_version()')[0][0] }
}

parentPort.on('message', async (m) => {
  try {
    const SQL = await ready
    if (m.type === 'open') {
      if (db) db.close()
      db = new SQL.Database(new Uint8Array(m.buffer))
      db.run('PRAGMA query_only = ON')
      parentPort.postMessage({ id: m.id, ok: true, value: schema() })
    } else if (m.type === 'query') {
      const started = performance.now()
      const results = []
      // The iterator frees each statement itself.
      for (const stmt of db.iterateStatements(m.sql)) {
        const columns = stmt.getColumnNames()
        const out = []
        let truncated = false
        while (stmt.step()) {
          if (out.length >= m.limit) { truncated = true; break }
          out.push(stmt.get().map((v) => (v instanceof Uint8Array ? { blob: v.length } : v)))
        }
        if (columns.length) results.push({ columns, rows: out, truncated })
      }
      parentPort.postMessage({ id: m.id, ok: true, value: { results, ms: Math.round(performance.now() - started) } })
    }
  } catch (err) {
    parentPort.postMessage({ id: m.id, ok: false, error: err && err.message ? err.message : String(err) })
  }
})
`

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer?: NodeJS.Timeout
}

/** One open database file: a worker holding it, and the requests waiting on it. */
class Session {
  private worker: Worker
  private pending = new Map<number, Pending>()
  private next = 1
  private dead = false

  constructor(readonly path: string) {
    // The package's main file is dist/sql-wasm.js; the .wasm file sits next to it.
    const entry = nodeRequire.resolve('sql.js')
    this.worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { sqlJsPath: entry, distDir: dirname(entry) } })
    this.worker.on('message', (m: { id: number; ok: boolean; value?: unknown; error?: string }) => {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.ok) p.resolve(m.value)
      else p.reject(new Error(m.error ?? 'The database reported an error'))
    })
    this.worker.on('error', (err) => this.fail(err))
    this.worker.on('exit', (code) => {
      if (!this.dead) this.fail(new Error(`The database worker stopped unexpectedly (exit code ${code})`))
    })
  }

  get isDead(): boolean {
    return this.dead
  }

  private fail(err: Error): void {
    this.dead = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  request<T>(message: Record<string, unknown>, transfer: ArrayBuffer[] = [], timeoutMs?: number): Promise<T> {
    if (this.dead) return Promise.reject(new Error('The database is closed'))
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = { resolve: resolve as (v: unknown) => void, reject }
      if (timeoutMs) {
        entry.timer = setTimeout(() => {
          // A query that will not finish cannot be interrupted from outside, so the whole worker is stopped.
          this.close()
          reject(new Error(`The query ran for more than ${timeoutMs / 1000} seconds and was stopped. Narrow it down (a WHERE or LIMIT) and run it again.`))
        }, timeoutMs)
      }
      this.pending.set(id, entry)
      this.worker.postMessage({ id, ...message }, transfer)
    })
  }

  /** Stops the worker (also what Stop does for a running query). Waiting requests are rejected. */
  close(): void {
    if (this.dead) return
    this.fail(new Error('The query was stopped'))
    void this.worker.terminate()
  }
}

const sessions = new Map<string, Session>()

async function loadFile(path: string): Promise<{ buffer: ArrayBuffer }> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`${path} is not a file`)
  if (info.size > MAX_FILE_BYTES) throw new Error(`The database is ${(info.size / 1048576).toFixed(0)} MB; the viewer opens files up to ${MAX_FILE_BYTES / 1048576} MB`)
  const data = await readFile(path)
  if (data.length < 100 || data.subarray(0, 16).toString('latin1') !== SQLITE_MAGIC) throw new Error(`${path} is not a SQLite database file`)
  return { buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer }
}

export async function openDatabase(path: string): Promise<DbSchema> {
  sessions.get(path)?.close()
  sessions.delete(path)
  const { buffer } = await loadFile(path)
  const session = new Session(path)
  sessions.set(path, session)
  try {
    return await session.request<DbSchema>({ type: 'open', buffer }, [buffer])
  } catch (err) {
    session.close()
    sessions.delete(path)
    throw err
  }
}

export async function queryDatabase(path: string, sql: string, limit = DEFAULT_LIMIT): Promise<DbQueryResult> {
  let session = sessions.get(path)
  if (!session || session.isDead) {
    // The worker was stopped (a timeout or Stop): load the file again, as a fresh start.
    await openDatabase(path)
    session = sessions.get(path)
  }
  if (!session) throw new Error('The database is not open')
  if (!sql.trim()) throw new Error('Type a SQL statement first')
  const capped = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
  return session.request<DbQueryResult>({ type: 'query', sql, limit: capped }, [], QUERY_TIMEOUT_MS)
}

export function registerDatabase(): void {
  ipcMain.handle('db:open', (_e, path: string) => openDatabase(path))
  ipcMain.handle('db:query', (_e, path: string, sql: string, limit?: number) => queryDatabase(path, sql, limit))
  ipcMain.handle('db:stop', (_e, path: string) => {
    sessions.get(path)?.close()
  })
  ipcMain.handle('db:close', (_e, path: string) => {
    sessions.get(path)?.close()
    sessions.delete(path)
  })
}

/** Run at quit: the workers must not keep the process alive. */
export function closeAllDatabases(): void {
  for (const s of sessions.values()) s.close()
  sessions.clear()
}
