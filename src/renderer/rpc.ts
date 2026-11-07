import { client } from '../shared/rpc'
import type { FileIndexApi } from '../main/platform/fileindex'
import type { SpellApi } from '../main/spell'
import type { HistoryApi } from '../main/history'
import type { ScratchApi } from '../main/scratch'
import type { NpmApi } from '../main/npm'
import type { TestApi } from '../main/testrun'
import type { HttpApi } from '../main/http'
import type { InspectApi } from '../main/inspect'
import type { DuplicatesApi } from '../main/duplicates'
import type { DepsApi } from '../main/deps'
import type { TerminalApi } from '../main/terminal'
import type { DockerApi } from '../main/docker'
import type { GithubApi } from '../main/github'
import type { DatabaseApi } from '../main/database'
import type { SettingsApi } from '../main/settings'
import type { ExtensionsApi } from '../main/extensions'
import type { GitApi } from '../main/git'

// Typed handles to backend services (see src/main/platform). Each call is one round trip to the main process.

export const fileIndex = client<FileIndexApi>('fileindex', (req) => window.forge.rpc(req))
export const spell = client<SpellApi>('spell', (req) => window.forge.rpc(req))
export const historyService = client<HistoryApi>('history', (req) => window.forge.rpc(req))
export const scratchService = client<ScratchApi>('scratch', (req) => window.forge.rpc(req))
export const npmService = client<NpmApi>('npm', (req) => window.forge.rpc(req))
export const testsService = client<TestApi>('tests', (req) => window.forge.rpc(req))
export const httpService = client<HttpApi>('http', (req) => window.forge.rpc(req))
export const inspectService = client<InspectApi>('inspect', (req) => window.forge.rpc(req))
export const duplicatesService = client<DuplicatesApi>('duplicates', (req) => window.forge.rpc(req))
export const depsService = client<DepsApi>('deps', (req) => window.forge.rpc(req))
export const terminalService = client<TerminalApi>('terminal', (req) => window.forge.rpc(req))
export const dockerService = client<DockerApi>('docker', (req) => window.forge.rpc(req))
export const githubService = client<GithubApi>('github', (req) => window.forge.rpc(req))
export const databaseService = client<DatabaseApi>('database', (req) => window.forge.rpc(req))
export const settingsService = client<SettingsApi>('settings', (req) => window.forge.rpc(req))
export const extensionsService = client<ExtensionsApi>('extensions', (req) => window.forge.rpc(req))
export const gitService = client<GitApi>('git', (req) => window.forge.rpc(req))
export const onBackendEvent = (cb: (topic: string, payload: unknown) => void): (() => void) => window.forge.onRpcEvent(cb)

/** Terminal output and exits arrive as bus events. Each subscription returns a function that removes it. */
export const onTermData = (cb: (id: number, data: string) => void): (() => void) =>
  window.forge.onRpcEvent((topic, payload) => {
    if (topic !== 'term.data') return
    const e = payload as { id: number; data: string }
    cb(e.id, e.data)
  })
export const onTermExit = (cb: (id: number, code: number) => void): (() => void) =>
  window.forge.onRpcEvent((topic, payload) => {
    if (topic !== 'term.exit') return
    const e = payload as { id: number; code: number }
    cb(e.id, e.code)
  })

// The backend indexes one project at a time. It is opened on first use (a snapshot makes that quick after the first
// time) and then kept current by the file watcher, so later calls are answered from memory.
let opened: { root: string; ready: Promise<unknown> } | null = null

/** Every file of the project, from the backend index. Rejects when the project can't be indexed (e.g. too many files). */
export async function indexedFiles(root: string): Promise<string[]> {
  if (opened?.root !== root) {
    const ready = fileIndex.open(root)
    opened = { root, ready }
    // A failed open must not stick: the next call tries again.
    ready.catch(() => {
      if (opened?.ready === ready) opened = null
    })
  }
  await opened.ready
  return fileIndex.list()
}
