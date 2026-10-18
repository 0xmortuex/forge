import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', '.idea', '.vscode'])
export const MAX_FILES = 50000

/** Visits every file under `root`, skipping build/vendor directories. Throws past MAX_FILES. */
export async function walkFiles(root: string, onFile: (path: string) => Promise<void> | void): Promise<void> {
  let count = 0
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name))
        continue
      }
      if (++count > MAX_FILES) throw new Error(`Project has more than ${MAX_FILES} files; refusing to scan`)
      await onFile(join(dir, e.name))
    }
  }
  await walk(root)
}
