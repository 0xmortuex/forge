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
import { setTerminalEmitter, TerminalService } from '../terminal'
import { DockerService } from '../docker'
import { GithubService } from '../github'
import { DatabaseService } from '../database'
import { SettingsService } from '../settings'
import { ExtensionsService } from '../extensions'
import { NpmService } from '../npm'
import { TestService } from '../testrun'
import { HttpService } from '../http'
import { InspectService } from '../inspect'
import { DuplicatesService } from '../duplicates'
import { DepsService } from '../deps'
import { GitService } from '../git'

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
registry.register({ id: 'forge.terminal', activation: 'lazy', provides: ['terminal'], activate: () => ({ services: { terminal: new TerminalService() } }) })
registry.register({ id: 'forge.docker', activation: 'lazy', provides: ['docker'], activate: () => ({ services: { docker: new DockerService() } }) })
registry.register({ id: 'forge.github', activation: 'lazy', provides: ['github'], activate: () => ({ services: { github: new GithubService() } }) })
registry.register({ id: 'forge.database', activation: 'lazy', provides: ['database'], activate: () => ({ services: { database: new DatabaseService() } }) })
registry.register({ id: 'forge.settings', activation: 'lazy', provides: ['settings'], activate: () => ({ services: { settings: new SettingsService() } }) })
registry.register({ id: 'forge.extensions', activation: 'lazy', provides: ['extensions'], activate: () => ({ services: { extensions: new ExtensionsService() } }) })
registry.register({ id: 'forge.git', activation: 'lazy', provides: ['git'], activate: () => ({ services: { git: new GitService() } }) })

export function registerPlatform(): void {
  // Set now, not when the module activates: the debugger starts terminals without ever calling the service.
  setTerminalEmitter((topic, payload) => registry.bus.publish(topic, payload))
  const server = new RpcServer((name) => registry.service(name))
  ipcMain.handle('rpc:call', (_e, req: RpcRequest) => server.dispatch(req))
  registry.bus.tap((topic, payload) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.webContents.isDestroyed()) win.webContents.send('rpc:event', topic, payload)
  })
  registry.startup().catch((err: unknown) => console.error('Platform startup failed', err))
}
