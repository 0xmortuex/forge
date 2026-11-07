import { app, BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { RpcServer, type RpcRequest } from '../../shared/rpc'
import { onFsChange } from '../watch'
import { FileIndex } from './fileindex'
import { ModuleRegistry } from './modules'
import { SpellService } from '../spell'
import { HistoryService } from '../history'
import { ScratchService } from '../scratch'
import { NpmService } from '../npm'
import { TestService } from '../testrun'
import { HttpService } from '../http'
import { InspectService } from '../inspect'
import { DuplicatesService } from '../duplicates'
import { DepsService } from '../deps'

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

registry.register({ id: 'forge.spell', activation: 'lazy', provides: ['spell'], activate: () => ({ services: { spell: new SpellService() } }) })
registry.register({ id: 'forge.history', activation: 'lazy', provides: ['history'], activate: () => ({ services: { history: new HistoryService() } }) })
registry.register({ id: 'forge.scratch', activation: 'lazy', provides: ['scratch'], activate: () => ({ services: { scratch: new ScratchService() } }) })
registry.register({ id: 'forge.npm', activation: 'lazy', provides: ['npm'], activate: () => ({ services: { npm: new NpmService() } }) })
registry.register({ id: 'forge.tests', activation: 'lazy', provides: ['tests'], activate: () => ({ services: { tests: new TestService() } }) })
registry.register({ id: 'forge.http', activation: 'lazy', provides: ['http'], activate: () => ({ services: { http: new HttpService() } }) })
registry.register({ id: 'forge.inspect', activation: 'lazy', provides: ['inspect'], activate: () => ({ services: { inspect: new InspectService() } }) })
registry.register({ id: 'forge.duplicates', activation: 'lazy', provides: ['duplicates'], activate: () => ({ services: { duplicates: new DuplicatesService() } }) })
registry.register({ id: 'forge.deps', activation: 'lazy', provides: ['deps'], activate: () => ({ services: { deps: new DepsService() } }) })

export function registerPlatform(): void {
  const server = new RpcServer((name) => registry.service(name))
  ipcMain.handle('rpc:call', (_e, req: RpcRequest) => server.dispatch(req))
  registry.bus.tap((topic, payload) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send('rpc:event', topic, payload)
  })
  registry.startup().catch((err: unknown) => console.error('Platform startup failed', err))
}
