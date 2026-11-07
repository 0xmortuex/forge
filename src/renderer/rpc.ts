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
import type { FilesApi } from '../main/files'
import type { FsChange, WatchApi } from '../main/watch'
import type { LspApi } from '../main/lsp'
import type { DebugApi, DebugEvent } from '../main/debug'
import type { AiApi, AiEvent } from '../main/ai'

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
export const filesService = client<FilesApi>('files', (req) => window.forge.rpc(req))
export const watchService = client<WatchApi>('watch', (req) => window.forge.rpc(req))
export const lspService = client<LspApi>('lsp', (req) => window.forge.rpc(req))
export const debugService = client<DebugApi>('debug', (req) => window.forge.rpc(req))
export const aiService = client<AiApi>('ai', (req) => window.forge.rpc(req))
export const onBackendEvent = (cb: (topic: string, payload: unknown) => void): (() => void) => window.forge.onRpcEvent(cb)

/** Streamed AI answers: delta / done / error events, each carrying the id of the request that asked. */
export const onAiEvent = (cb: (e: AiEvent) => void): (() => void) =>
  window.forge.onRpcEvent((topic, payload) => {
    if (topic === 'ai.event') cb(payload as AiEvent)
  })

/** Debugger events: stopped, resumed, output, session ended ... */
export const onDebugEvent = (cb: (evt: DebugEvent) => void): (() => void) =>
  window.forge.onRpcEvent((topic, payload) => {
    if (topic === 'debug.event') cb(payload as DebugEvent)
  })

/** Language server events: diagnostics, log lines and edits the server wants applied (answer with lspService.applyEditResult). */
export const onLspDiagnostics = (cb: (uri: string, diagnostics: unknown[]) => void): (() => void) =>
  window.forge.onRpcEvent((topic, payload) => {
    if (topic !== 'lsp.diagnostics') return
    const e = payload as { uri: string; diagnostics: unknown[] }
    cb(e.uri, e.diagnostics)
  })
export const onLspLog = (cb: (server: string, type: number, message: string) => void): (() => void) =>
  window.forge.onRpcEvent((topic, payload) => {
    if (topic !== 'lsp.log') return
    const e = payload as { server: string; type: number; message: string }
    cb(e.server, e.type, e.message)
  })
export const onLspApplyEdit = (cb: (id: number, edit: unknown) => void): (() => void) =>
  window.forge.onRpcEvent((topic, payload) => {
    if (topic !== 'lsp.applyEdit') return
    const e = payload as { id: number; edit: unknown }
    cb(e.id, e.edit)
  })

/** The project watcher reports changes made outside Forge as bus events. */
export const onFsChanged = (cb: (change: FsChange) => void): (() => void) =>
  window.forge.onRpcEvent((topic, payload) => {
    if (topic === 'fs.changed') cb(payload as FsChange)
  })
export const onFsWatchError = (cb: (message: string) => void): (() => void) =>
  window.forge.onRpcEvent((topic, payload) => {
    if (topic === 'fs.watchError') cb(payload as string)
  })

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
