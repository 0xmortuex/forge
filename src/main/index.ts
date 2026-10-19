import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { realpathSync } from 'node:fs'
import { access, cp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { registerDebug } from './debug'
import { registerExtensions, registerExtensionScheme } from './extensions'
import { registerGit } from './git'
import { registerSettings } from './settings'
import { replaceInFiles, searchProject, type SearchOptions } from './search'
import { killAllLsp, registerLsp } from './lsp'
import { registerHistory } from './history'
import { registerWatch, stopWatching } from './watch'
import { registerScratch } from './scratch'
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
    minWidth: 900,
    minHeight: 560,
    titleBarStyle: 'hidden',
    // Windows/Linux draw their window buttons over our toolbar; macOS keeps its traffic lights on the left.
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 13 } }
      : { titleBarOverlay: { color: '#101d22', symbolColor: '#b0bec5', height: 40 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)

  // Settings and the session are saved a moment after each change. Before the window goes away, ask the page to
  // write anything still pending, and wait for it (but never for long: a stuck page must not block closing).
  let flushed = false
  win.on('close', (e) => {
    if (flushed || win.webContents.isDestroyed()) return
    e.preventDefault()
    const finish = (): void => {
      if (flushed) return
      flushed = true
      win.close()
    }
    ipcMain.once('app:flushed', (ev) => {
      if (ev.sender === win.webContents) finish()
    })
    win.webContents.send('app:flush')
    setTimeout(finish, 1500)
  })

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

ipcMain.handle('fs:search', (_e, root: string, query: string, options: SearchOptions = {}) => searchProject(root, query, options))
ipcMain.handle('fs:replace', (_e, query: string, options: SearchOptions, replacement: string, paths: string[]) =>
  replaceInFiles(query, options, replacement, paths)
)

const assertMissing = async (path: string): Promise<void> => {
  const exists = await access(path).then(() => true, () => false)
  if (exists) throw new Error(`Already exists: ${path}`)
}

ipcMain.handle('fs:exists', (_e, path: string) => access(path).then(() => true, () => false))
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif'
}
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** An image file as a data: URL (the page may not load files directly). */
ipcMain.handle('fs:readDataUrl', async (_e, path: string): Promise<{ url: string; bytes: number }> => {
  const mime = MIME[extname(path).slice(1).toLowerCase()]
  if (!mime) throw new Error(`Not an image type Forge can show: ${extname(path) || path}`)
  const buf = await readFile(path)
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`${basename(path)} is too large to show (${Math.round(buf.length / 1048576)} MB)`)
  return { url: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length }
})

/** Opens a web or mail link in the user's browser. Anything else is refused. */
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (!/^(https?:|mailto:)/i.test(url)) throw new Error(`Refusing to open ${url}`)
  return shell.openExternal(url)
})

/** Copies a file or a folder (and everything in it). Never overwrites. */
ipcMain.handle('fs:copy', (_e, from: string, to: string) => cp(from, to, { recursive: true, errorOnExist: true, force: false }))
ipcMain.handle('fs:createFile', (_e, path: string) => writeFile(path, '', { flag: 'wx' }))
ipcMain.handle('fs:createDir', (_e, path: string) => mkdir(path))
ipcMain.handle('fs:rename', async (_e, from: string, to: string) => {
  await assertMissing(to) // fs.rename would silently overwrite
  await rename(from, to)
})
// Recycle Bin instead of permanent delete.
// The minimize/maximize/close buttons are drawn by the OS over our toolbar; keep their colors in step with the theme.
const COLOR = /^#[0-9a-f]{6}$/i
ipcMain.handle('win:titleBar', (e, color: string, symbolColor: string) => {
  if (!COLOR.test(color) || !COLOR.test(symbolColor)) throw new Error('Title bar colors must be #rrggbb')
  if (process.platform === 'darwin') return // macOS keeps its own traffic lights
  BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({ color, symbolColor, height: 40 })
})
// The real path of a folder: aliases (symlinks, junctions, Windows 8.3 short names like RUNNER~1) resolved. Git,
// debuggers and language servers all report real paths, so the project has to be addressed by one too.
ipcMain.handle('fs:realpath', (_e, path: string) => realpathSync.native(path))
ipcMain.handle('fs:trash', (_e, path: string) => shell.trashItem(path))
ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))

ipcMain.handle('fs:readFile', (_e, path: string) => readFile(path, 'utf8'))

ipcMain.handle('fs:writeFile', (_e, path: string, content: string) =>
  writeFile(path, content, 'utf8')
)

registerExtensionScheme() // has to happen before the app is ready

// Tests point this at a temp folder so they never touch the real user's settings.
if (process.env['FORGE_USER_DATA']) app.setPath('userData', process.env['FORGE_USER_DATA'])

registerSettings()
registerExtensions()
registerTerminal()
registerLsp()
registerGit()
registerDebug()
registerHistory()
registerWatch()
registerScratch()
let terminalsEnded = false
app.on('before-quit', (e) => {
  stopWatching()
  killAllLsp()
  if (terminalsEnded) return
  // Hold the quit until the terminals have exited, then quit again (see killAllTerminals).
  e.preventDefault()
  terminalsEnded = true
  killAllTerminals()
    .catch((err: unknown) => console.error('Ending the terminals failed', err))
    .finally(() => app.quit())
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
