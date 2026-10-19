import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, clipboard, ipcMain } from 'electron'

// Scratch files: throwaway files that live outside any project (in Forge's data folder), for trying things out.
// "New Scratch File" makes scratch-1.ts, scratch-2.py ... and opens it like any other file.

const dir = (): string => join(app.getPath('userData'), 'scratches')

export function registerScratch(): void {
  ipcMain.handle('scratch:create', async (_e, ext: string): Promise<string> => {
    if (!/^[a-z0-9]{1,8}$/i.test(ext)) throw new Error(`Invalid file extension: ${ext}`)
    await mkdir(dir(), { recursive: true })
    const taken = new Set(await readdir(dir()))
    let n = 1
    while (taken.has(`scratch-${n}.${ext}`)) n++
    const path = join(dir(), `scratch-${n}.${ext}`)
    await writeFile(path, '', { flag: 'wx' }) // never overwrite an existing scratch
    return path
  })

  /** Newest first. */
  ipcMain.handle('scratch:list', async (): Promise<string[]> => {
    let names: string[]
    try {
      names = await readdir(dir())
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    const withTime = await Promise.all(names.map(async (n) => ({ path: join(dir(), n), time: (await stat(join(dir(), n))).mtimeMs })))
    return withTime.sort((a, b) => b.time - a.time).map((x) => x.path)
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())
}
