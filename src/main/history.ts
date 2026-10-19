import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'

// Local History: Forge keeps a snapshot of a file whenever you open it (if it changed since the last one) and whenever
// you save it, so you can see what it looked like earlier and go back. Snapshots live in the user-data folder, one
// folder per file, one text file per snapshot named after its time.

const MAX_PER_FILE = 100
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024 // bigger files (logs, bundles) are left out

export interface Snapshot {
  id: string
  /** Milliseconds since the epoch. */
  time: number
  size: number
}

const root = (): string => join(app.getPath('userData'), 'history')
// Windows paths ignore case, so "C:\A.txt" and "c:\a.txt" are one file.
const dirFor = (path: string): string => join(root(), createHash('sha1').update(process.platform === 'win32' ? path.toLowerCase() : path).digest('hex').slice(0, 20))

async function ids(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => /^\d+\.txt$/.test(n)).map((n) => n.slice(0, -4)).sort((a, b) => Number(a) - Number(b))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/** Stores a snapshot unless it equals the latest one. Returns whether anything was stored. */
export async function addSnapshot(path: string, text: string): Promise<boolean> {
  if (Buffer.byteLength(text) > MAX_SNAPSHOT_BYTES) return false
  const dir = dirFor(path)
  await mkdir(dir, { recursive: true })
  const all = await ids(dir)
  const latest = all[all.length - 1]
  if (latest !== undefined && (await readFile(join(dir, `${latest}.txt`), 'utf8')) === text) return false
  let id = Date.now()
  if (latest !== undefined && id <= Number(latest)) id = Number(latest) + 1 // two snapshots in the same millisecond
  await writeFile(join(dir, `${id}.txt`), text, 'utf8')
  await writeFile(join(dir, 'path.txt'), path, 'utf8') // which file this folder belongs to
  // Prune: too many, or too old (the newest is always kept).
  const now = Date.now()
  const stale = [...all, String(id)].filter((n, i, list) => i < list.length - 1 && (list.length - i > MAX_PER_FILE || now - Number(n) > MAX_AGE_MS))
  for (const n of stale) await rm(join(dir, `${n}.txt`), { force: true })
  return true
}

export async function listSnapshots(path: string): Promise<Snapshot[]> {
  const dir = dirFor(path)
  const out: Snapshot[] = []
  for (const id of await ids(dir)) out.push({ id, time: Number(id), size: (await stat(join(dir, `${id}.txt`))).size })
  return out.reverse() // newest first
}

export async function readSnapshot(path: string, id: string): Promise<string> {
  if (!/^\d+$/.test(id)) throw new Error(`Invalid history entry: ${id}`) // never let an id walk out of the folder
  return readFile(join(dirFor(path), `${id}.txt`), 'utf8')
}

export function registerHistory(): void {
  ipcMain.handle('history:add', (_e, path: string, text: string) => addSnapshot(path, text))
  ipcMain.handle('history:list', (_e, path: string) => listSnapshots(path))
  ipcMain.handle('history:read', (_e, path: string, id: string) => readSnapshot(path, id))
}
