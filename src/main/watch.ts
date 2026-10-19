import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { ipcMain, type WebContents } from 'electron'

// Watches the open project for changes made outside Forge (a build, git on the command line, another editor), so the
// tree, the open files and the git status stay in step without a manual refresh.

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

const FLUSH_MS = 250
// Folders whose churn would only be noise (and, for node_modules, a flood).
const NOISE = /(^|[\\/])(node_modules|\.vite|out|dist)([\\/]|$)/
const GIT_INTERESTING = /^\.git[\\/](HEAD|index|refs|MERGE_HEAD|REBASE_HEAD|CHERRY_PICK_HEAD|ORIG_HEAD)(?:[\\/]|$)/

let watcher: FSWatcher | null = null

function stop(): void {
  watcher?.close()
  watcher = null
}

export function registerWatch(): void {
  ipcMain.handle('fs:watch', (e, root: string) => {
    stop()
    const wc: WebContents = e.sender
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
      if (!wc.isDestroyed() && (change.paths.length || change.git || change.all)) wc.send('fs:changed', change)
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
    watcher.on('error', (err) => {
      if (!wc.isDestroyed()) wc.send('fs:watchError', err.message)
    })
  })
  ipcMain.handle('fs:unwatch', () => stop())
}

export const stopWatching = stop
