import { app, BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { RpcServer, type RpcRequest } from '../../shared/rpc'
import { onFsChange } from '../watch'
import { FileIndex } from './fileindex'
import { ModuleRegistry } from './modules'

// The backend platform: a module registry, the typed RPC entry point the UI talks to, and the built-in modules.
// Features are moved onto it one at a time; the older ipcMain handlers keep working beside it meanwhile.

export const registry = new ModuleRegistry()

registry.register({
  id: 'forge.fileindex',
  activation: 'lazy',
  provides: ['fileindex'],
  activate: (ctx) => {
    const index = new FileIndex({
      snapshotPath: (root) => join(app.getPath('userData'), 'index', `${createHash('sha1').update(root).digest('hex')}.json`),
      onState: (state) => ctx.publish('fileindex.state', state)
    })
    // Keep the index current from the same watcher the window uses. A failure is announced, never dropped.
    const stop = onFsChange((change) => {
      if (index.state() === 'idle') return
      index.changed(change.paths, change.all).catch((err: unknown) => ctx.publish('fileindex.error', err instanceof Error ? err.message : String(err)))
    })
    return { services: { fileindex: index }, dispose: stop }
  }
})

export function registerPlatform(): void {
  const server = new RpcServer((name) => registry.service(name))
  ipcMain.handle('rpc:call', (_e, req: RpcRequest) => server.dispatch(req))
  registry.bus.tap((topic, payload) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send('rpc:event', topic, payload)
  })
  registry.startup().catch((err: unknown) => console.error('Platform startup failed', err))
}
