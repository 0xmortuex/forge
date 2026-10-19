import { app, ipcMain, net, protocol, shell } from 'electron'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// Extensions live in <user data>/extensions/<id>/ and are plain ES modules. The renderer imports them through
// the forge-ext:// protocol, which only serves files from inside an extension's own folder.

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  main: string
  /** Why it can't be used (bad manifest, missing main file...). Absent when it's fine. */
  error?: string
}

const SCHEME = 'forge-ext'
// forge-ext URLs are "standard", so the host is lowercased; folder names must survive that unchanged.
const ID = /^[a-z0-9][a-z0-9._-]*$/

const extensionsDir = (): string => join(app.getPath('userData'), 'extensions')

/** Must run before the app is ready: lets the page `import()` from the scheme under its content-security policy. */
export function registerExtensionScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

async function describe(id: string): Promise<ExtensionInfo> {
  const base: ExtensionInfo = { id, name: id, version: '', description: '', main: 'index.js' }
  if (!ID.test(id)) return { ...base, error: 'The folder name must be lowercase letters, digits, "-", "_" or "."' }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(await readFile(join(extensionsDir(), id, 'extension.json'), 'utf8')) as Record<string, unknown>
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { ...base, error: code === 'ENOENT' ? 'No extension.json in this folder' : `extension.json: ${(err as Error).message}` }
  }
  const info: ExtensionInfo = {
    id,
    name: typeof manifest['name'] === 'string' && manifest['name'] ? manifest['name'] : id,
    version: typeof manifest['version'] === 'string' ? manifest['version'] : '',
    description: typeof manifest['description'] === 'string' ? manifest['description'] : '',
    main: typeof manifest['main'] === 'string' && manifest['main'] ? manifest['main'] : 'index.js'
  }
  const entry = resolve(extensionsDir(), id, info.main)
  const root = resolve(extensionsDir(), id)
  if (!entry.startsWith(root + sep)) return { ...info, error: '"main" must point to a file inside the extension folder' }
  try {
    if (!(await stat(entry)).isFile()) throw new Error('not a file')
  } catch {
    return { ...info, error: `The main file "${info.main}" does not exist` }
  }
  return info
}

export function registerExtensions(): void {
  ipcMain.handle('extensions:list', async (): Promise<ExtensionInfo[]> => {
    let names: string[] = []
    try {
      const entries = await readdir(extensionsDir(), { withFileTypes: true })
      names = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err // no extensions folder yet is normal
    }
    return Promise.all(names.map(describe))
  })

  ipcMain.handle('extensions:openDir', async () => {
    await mkdir(extensionsDir(), { recursive: true })
    const problem = await shell.openPath(extensionsDir())
    if (problem) throw new Error(`Could not open the extensions folder: ${problem}`)
    return extensionsDir()
  })

  void app.whenReady().then(() => {
    protocol.handle(SCHEME, (request) => {
      const url = new URL(request.url)
      const root = resolve(extensionsDir(), decodeURIComponent(url.hostname))
      const file = resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''))
      // Never serve anything outside the extension's own folder (no ../ tricks).
      if (!ID.test(decodeURIComponent(url.hostname)) || !file.startsWith(root + sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      return net.fetch(pathToFileURL(file).href)
    })
  })
}
