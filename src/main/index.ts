import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#101d22',
    title: 'Forge',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#101d22', symbolColor: '#b0bec5', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return res.canceled ? null : (res.filePaths[0] ?? null)
})

ipcMain.handle('fs:readDir', async (_e, dir: string): Promise<DirEntry[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .map((e) => ({ name: e.name, path: join(dir, e.name), isDir: e.isDirectory() }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
})

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', '.idea', '.vscode'])
const MAX_FILES = 50000

ipcMain.handle('fs:listFiles', async (_e, root: string): Promise<string[]> => {
  const files: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) throw new Error(`Project has more than ${MAX_FILES} files; refusing to index`)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name))
      } else files.push(join(dir, e.name))
    }
  }
  await walk(root)
  return files
})

ipcMain.handle('fs:readFile', (_e, path: string) => readFile(path, 'utf8'))

ipcMain.handle('fs:writeFile', (_e, path: string, content: string) =>
  writeFile(path, content, 'utf8')
)

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
