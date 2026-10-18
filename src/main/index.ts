import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { searchProject } from './search'
import { killAllTerminals, registerTerminal } from './terminal'
import { walkFiles } from './walk'

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

ipcMain.handle('fs:listFiles', async (_e, root: string): Promise<string[]> => {
  const files: string[] = []
  await walkFiles(root, (p) => void files.push(p))
  return files
})

ipcMain.handle('fs:search', (_e, root: string, query: string) => searchProject(root, query))

const assertMissing = async (path: string): Promise<void> => {
  const exists = await access(path).then(() => true, () => false)
  if (exists) throw new Error(`Already exists: ${path}`)
}

ipcMain.handle('fs:createFile', (_e, path: string) => writeFile(path, '', { flag: 'wx' }))
ipcMain.handle('fs:createDir', (_e, path: string) => mkdir(path))
ipcMain.handle('fs:rename', async (_e, from: string, to: string) => {
  await assertMissing(to) // fs.rename would silently overwrite
  await rename(from, to)
})
// Recycle Bin instead of permanent delete.
ipcMain.handle('fs:trash', (_e, path: string) => shell.trashItem(path))

ipcMain.handle('fs:readFile', (_e, path: string) => readFile(path, 'utf8'))

ipcMain.handle('fs:writeFile', (_e, path: string, content: string) =>
  writeFile(path, content, 'utf8')
)

registerTerminal()
app.on('before-quit', killAllTerminals)

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
