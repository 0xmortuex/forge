import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// User data lives in Electron's per-user folder: settings.json (what the user chose), state.json (what Forge
// remembers: open folder, tabs, layout) and themes/*.json (custom themes).

const SETTINGS = 'settings.json'
const STATE = 'state.json'
const THEMES = 'themes'
const CUSTOM_CSS = 'custom.css'

const userPath = (...parts: string[]): string => join(app.getPath('userData'), ...parts)

/** Null if the file doesn't exist yet; any other failure is real and propagates. */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Write to a temp file and rename, so a crash mid-write can't leave a half-written settings file. */
async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}

function parseObject(text: string, what: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    throw new Error(`${what} is not valid JSON: ${(err as Error).message}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} must be a JSON object`)
  return value as Record<string, unknown>
}

export interface LoadedUserData {
  settings: Record<string, unknown>
  state: Record<string, unknown>
  themes: { name: string; text: string }[]
  /** A problem reading settings/state, to be shown to the user. Defaults are used meanwhile. */
  errors: string[]
  dir: string
  settingsPath: string
  /** Contents of custom.css (empty if there is none) and where it lives. */
  customCss: string
  customCssPath: string
}

let settingsBroken = false

export function registerSettings(): void {
  ipcMain.handle('settings:load', async (): Promise<LoadedUserData> => {
    const errors: string[] = []
    let settings: Record<string, unknown> = {}
    let state: Record<string, unknown> = {}

    const settingsText = await readText(userPath(SETTINGS))
    if (settingsText !== null) {
      try {
        settings = parseObject(settingsText, SETTINGS)
      } catch (err) {
        settingsBroken = true // keep the user's file safe from our next save
        errors.push(`${(err as Error).message} — using defaults until it is fixed (your file is kept as ${SETTINGS}.broken)`)
      }
    }
    const stateText = await readText(userPath(STATE))
    if (stateText !== null) {
      try {
        state = parseObject(stateText, STATE)
      } catch (err) {
        errors.push(`${(err as Error).message} — starting with a fresh session`)
      }
    }

    let themeNames: string[] = []
    try {
      themeNames = (await readdir(userPath(THEMES))).filter((n) => n.toLowerCase().endsWith('.json')).sort()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err // no themes folder yet is normal
    }
    const themes = await Promise.all(themeNames.map(async (name) => ({ name, text: (await readFile(userPath(THEMES, name), 'utf8')) })))

    const customCss = (await readText(userPath(CUSTOM_CSS))) ?? ''
    return {
      settings,
      state,
      themes,
      errors,
      dir: app.getPath('userData'),
      settingsPath: userPath(SETTINGS),
      customCss,
      customCssPath: userPath(CUSTOM_CSS)
    }
  })

  ipcMain.handle('settings:save', async (_e, text: string) => {
    parseObject(text, 'Settings to save') // never write something we couldn't read back
    if (settingsBroken) {
      await copyFile(userPath(SETTINGS), userPath(`${SETTINGS}.broken`))
      settingsBroken = false
    }
    await writeAtomic(userPath(SETTINGS), text)
  })

  ipcMain.handle('state:save', async (_e, text: string) => {
    parseObject(text, 'State to save')
    await writeAtomic(userPath(STATE), text)
  })

  /** Creates custom.css with a short guide if it doesn't exist yet, and returns its path. */
  ipcMain.handle('settings:ensureCss', async () => {
    if ((await readText(userPath(CUSTOM_CSS))) === null) {
      await writeAtomic(
        userPath(CUSTOM_CSS),
        `/* Forge custom CSS: restyle anything. It applies when you save this file in Forge.
   If something breaks, turn it off in Settings (Appearance > Apply custom.css) or delete this file.

   Colors come from variables, for example:  --accent  --island  --text  --err  --ok
   (Settings can override some of them, so prefer targeting elements by id or class.)

   Examples:
     #toolbar { height: 52px; }
     .tab.active { font-weight: 700; }
     .island { box-shadow: 0 0 24px var(--accent-soft); }
*/
`
      )
    }
    return userPath(CUSTOM_CSS)
  })

  ipcMain.handle('themes:openDir', async () => {
    await mkdir(userPath(THEMES), { recursive: true })
    const problem = await shell.openPath(userPath(THEMES))
    if (problem) throw new Error(`Could not open the themes folder: ${problem}`)
    return userPath(THEMES)
  })

  ipcMain.handle('win:toggleFullscreen', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('No window to toggle full screen on')
    win.setFullScreen(!win.isFullScreen())
    return win.isFullScreen()
  })
}
