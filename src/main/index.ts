import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerDebug } from './debug'
import { registerExtensions, registerExtensionScheme } from './extensions'
import { registerSettings } from './settings'
import { killAllLsp } from './lsp'
import { registerAi } from './ai'
import { closeAllDatabases } from './database'
import { stopWatching } from './watch'
import { registerPlatform } from './platform'
import { killAllTerminals } from './terminal'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#101d22',
    title: 'Forge',
    // The window and taskbar icon (out/main/index.js -> ../../build/icon.png).
    icon: join(__dirname, '../../build/icon.png'),
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

/** Opens an HTML or SVG file from the project in the default browser. */
ipcMain.handle('shell:openInBrowser', (_e, path: string) => {
  if (!/\.(html?|svg|xhtml)$/i.test(path)) throw new Error('Only HTML and SVG files can be opened in the browser')
  return shell.openExternal(pathToFileURL(path).href)
})

/** Opens a web or mail link in the user's browser. Anything else is refused. */
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (!/^(https?:|mailto:)/i.test(url)) throw new Error(`Refusing to open ${url}`)
  return shell.openExternal(url)
})

// Recycle Bin instead of permanent delete.
// The minimize/maximize/close buttons are drawn by the OS over our toolbar; keep their colors in step with the theme.
const COLOR = /^#[0-9a-f]{6}$/i
ipcMain.handle('win:titleBar', (e, color: string, symbolColor: string) => {
  if (!COLOR.test(color) || !COLOR.test(symbolColor)) throw new Error('Title bar colors must be #rrggbb')
  if (process.platform === 'darwin') return // macOS keeps its own traffic lights
  BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({ color, symbolColor, height: 40 })
})

ipcMain.handle('fs:trash', (_e, path: string) => shell.trashItem(path))
ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
ipcMain.handle('clipboard:read', () => clipboard.readText())

registerExtensionScheme() // has to happen before the app is ready

// Tests point this at a temp folder so they never touch the real user's settings.
if (process.env['FORGE_USER_DATA']) app.setPath('userData', process.env['FORGE_USER_DATA'])

registerSettings()
registerExtensions()
registerDebug()
registerAi()
registerPlatform()
let terminalsEnded = false
app.on('before-quit', (e) => {
  stopWatching()
  killAllLsp()
  closeAllDatabases()
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
