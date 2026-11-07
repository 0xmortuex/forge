import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

// Watches the open project for changes made outside Forge (a build, git on the command line, another editor), so the
// tree, the open files and the git status stay in step without a manual refresh. Changes are published as "fs.changed"
// events, a failing watcher as "fs.watchError" (the platform sets where they go); backend modules also hear them
// through onFsChange.

export interface FsChange {
  /** Absolute paths that changed (created, removed, modified or renamed). */
  paths: string[]
  /** Something inside .git changed (a commit, checkout, fetch ... done elsewhere). */
  git: boolean
  /**
   * The operating system dropped events (too many changes at once, e.g. an install or a big checkout), so anything may
   * have changed: everything shown has to be checked again.
   */
  all?: boolean
}

type Emit = (topic: string, payload: unknown) => void
let emit: Emit = () => {
  throw new Error('File watcher events have no destination: the platform did not set an emitter')
}
export function setWatchEmitter(fn: Emit): void {
  emit = fn
}

const FLUSH_MS = 250
// Folders whose churn would only be noise (and, for node_modules, a flood).
const NOISE = /(^|[\\/])(node_modules|\.vite|out|dist)([\\/]|$)/
const GIT_INTERESTING = /^\.git[\\/](HEAD|index|refs|MERGE_HEAD|REBASE_HEAD|CHERRY_PICK_HEAD|ORIG_HEAD)(?:[\\/]|$)/

let watcher: FSWatcher | null = null
const listeners = new Set<(change: FsChange) => void>()

/** Backend modules (the file index) hear about changes here, in addition to the window. */
export function onFsChange(cb: (change: FsChange) => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

function stop(): void {
  watcher?.close()
  watcher = null
}

export interface WatchApi {
  watch(root: string): Promise<void>
  unwatch(): Promise<void>
}

/** Provided as the "watch" service (see platform). One project is watched at a time; watching another replaces it. */
export class WatchService implements WatchApi {
  async watch(root: string): Promise<void> {
    stop()
    let queued = new Set<string>()
    let git = false
    let all = false
    let timer: NodeJS.Timeout | undefined
    const flush = (): void => {
      timer = undefined
      const change: FsChange = { paths: [...queued], git, all }
      queued = new Set()
      git = false
      all = false
      if (!change.paths.length && !change.git && !change.all) return
      emit('fs.changed', change)
      for (const cb of listeners) cb(change)
    }
    // recursive: Windows and macOS always, Linux with Node 20+. A failure here is reported to the caller.
    watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
      if (!filename) {
        // No name: the system's notification buffer overflowed and events were lost.
        all = true
        timer ??= setTimeout(flush, FLUSH_MS)
        return
      }
      const rel = filename.toString()
      if (rel.startsWith('.git')) {
        if (GIT_INTERESTING.test(rel)) git = true
      } else if (!NOISE.test(rel)) queued.add(join(root, rel))
      else return
      timer ??= setTimeout(flush, FLUSH_MS)
    })
    watcher.on('error', (err) => emit('fs.watchError', err.message))
  }

  async unwatch(): Promise<void> {
    stop()
  }
}

export const stopWatching = stop
