import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { DirEntry } from '../main/index'
import type { ExtensionInfo } from '../main/extensions'
import type { LoadedUserData } from '../main/settings'
import type { DebugEvent, DebugEval, DebugKind, DebugScope, DebugVar } from '../main/debug'
import type { Breakpoint } from '../main/debug-types'
import type { BlameLine, BranchInfo, ChangeKind, CommitDetails, CommitFile, CommitInfo, GitStatus, LogQuery, OpResult, StashEntry } from '../main/git'
import type { SearchOptions, SearchResult } from '../main/search'
import type { Snapshot } from '../main/history'
import type { FsChange } from '../main/watch'
import type { HttpRequestSpec, HttpResponse } from '../main/http'
import type { InspectResult } from '../main/inspect'
import type { AiEvent, AiRequest } from '../main/ai'
import type { PtySpec } from '../main/terminal'

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', dir),
  listFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:listFiles', root),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', path, content),
  search: (root: string, query: string, options: SearchOptions = {}): Promise<SearchResult> =>
    ipcRenderer.invoke('fs:search', root, query, options),
  replaceInFiles: (query: string, options: SearchOptions, replacement: string, paths: string[]): Promise<number> =>
    ipcRenderer.invoke('fs:replace', query, options, replacement, paths),
  /** Shows the file in Explorer / Finder. */
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  exists: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', path),
  readDataUrl: (path: string): Promise<{ url: string; bytes: number }> => ipcRenderer.invoke('fs:readDataUrl', path),
  openInBrowser: (path: string): Promise<void> => ipcRenderer.invoke('shell:openInBrowser', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  aiChat: (id: number, req: AiRequest): Promise<void> => ipcRenderer.invoke('ai:chat', id, req),
  aiCancel: (id: number): Promise<void> => ipcRenderer.invoke('ai:cancel', id),
  aiComplete: (req: AiRequest): Promise<string> => ipcRenderer.invoke('ai:complete', req),
  aiTest: (baseUrl: string, model: string): Promise<{ reply: string; ms: number }> => ipcRenderer.invoke('ai:test', baseUrl, model),
  aiKeySet: (key: string): Promise<void> => ipcRenderer.invoke('ai:key-set', key),
  aiKeyClear: (): Promise<void> => ipcRenderer.invoke('ai:key-clear'),
  aiKeyStatus: (): Promise<{ stored: boolean; encryption: boolean }> => ipcRenderer.invoke('ai:key-status'),
  onAiEvent: (cb: (e: AiEvent) => void): (() => void) => {
    const listener = (_e: unknown, event: AiEvent): void => cb(event)
    ipcRenderer.on('ai:event', listener)
    return () => ipcRenderer.removeListener('ai:event', listener)
  },
  inspect: (root: string): Promise<InspectResult> => ipcRenderer.invoke('inspect:run', root),
  httpSend: (spec: HttpRequestSpec): Promise<HttpResponse> => ipcRenderer.invoke('http:send', spec),
  copy: (from: string, to: string): Promise<void> => ipcRenderer.invoke('fs:copy', from, to),
  createFile: (path: string): Promise<void> => ipcRenderer.invoke('fs:createFile', path),
  createDir: (path: string): Promise<void> => ipcRenderer.invoke('fs:createDir', path),
  rename: (from: string, to: string): Promise<void> => ipcRenderer.invoke('fs:rename', from, to),
  scratchCreate: (ext: string): Promise<string> => ipcRenderer.invoke('scratch:create', ext),
  scratchList: (): Promise<string[]> => ipcRenderer.invoke('scratch:list'),
  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  historyAdd: (path: string, text: string): Promise<boolean> => ipcRenderer.invoke('history:add', path, text),
  historyList: (path: string): Promise<Snapshot[]> => ipcRenderer.invoke('history:list', path),
  historyRead: (path: string, id: string): Promise<string> => ipcRenderer.invoke('history:read', path, id),
  lspWorkspace: (root: string, method: string, params: unknown): Promise<{ server: string; result?: unknown; error?: string }[]> =>
    ipcRenderer.invoke('lsp:workspace', root, method, params),
  realpath: (path: string): Promise<string> => ipcRenderer.invoke('fs:realpath', path),
  trash: (path: string): Promise<void> => ipcRenderer.invoke('fs:trash', path),

  termCreate: (cwd: string, cols: number, rows: number, spec?: PtySpec): Promise<number> =>
    ipcRenderer.invoke('term:create', cwd, cols, rows, spec),
  termWrite: (id: number, data: string): Promise<void> => ipcRenderer.invoke('term:write', id, data),
  termResize: (id: number, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('term:resize', id, cols, rows),
  termKill: (id: number): Promise<void> => ipcRenderer.invoke('term:kill', id),
  lspOpen: (root: string, uri: string, path: string, version: number, text: string): Promise<boolean> =>
    ipcRenderer.invoke('lsp:open', root, uri, path, version, text),
  lspChange: (uri: string, version: number, text: string): Promise<void> =>
    ipcRenderer.invoke('lsp:change', uri, version, text),
  lspClose: (uri: string): Promise<void> => ipcRenderer.invoke('lsp:close', uri),
  lspRequest: (uri: string, method: string, params: unknown): Promise<unknown> =>
    ipcRenderer.invoke('lsp:request', uri, method, params),
  lspCapabilities: (uri: string): Promise<Record<string, any>> => ipcRenderer.invoke('lsp:capabilities', uri),
  lspApplyEditResult: (id: number, applied: boolean, failureReason?: string): Promise<void> =>
    ipcRenderer.invoke('lsp:applyEditResult', id, applied, failureReason),
  onLspApplyEdit: (cb: (id: number, edit: unknown) => void): void => {
    ipcRenderer.on('lsp:applyEdit', (_e, id: number, edit: unknown) => cb(id, edit))
  },
  onLspDiagnostics: (cb: (uri: string, diagnostics: unknown[]) => void): void => {
    ipcRenderer.on('lsp:diagnostics', (_e, uri: string, diagnostics: unknown[]) => cb(uri, diagnostics))
  },
  onLspLog: (cb: (server: string, type: number, message: string) => void): void => {
    ipcRenderer.on('lsp:log', (_e, server: string, type: number, message: string) => cb(server, type, message))
  },
  gitLog: (root: string, q: LogQuery): Promise<CommitInfo[]> => ipcRenderer.invoke('git:log', root, q),
  gitCommitDetails: (root: string, sha: string): Promise<CommitDetails> => ipcRenderer.invoke('git:commit-details', root, sha),
  gitFileAt: (root: string, sha: string, path: string): Promise<string> => ipcRenderer.invoke('git:file-at', root, sha, path),
  gitBranchesFull: (root: string): Promise<BranchInfo[]> => ipcRenderer.invoke('git:branches-full', root),
  gitTags: (root: string): Promise<string[]> => ipcRenderer.invoke('git:tags', root),
  gitCheckout: (root: string, target: string, kind: 'local' | 'remote' | 'detached'): Promise<void> => ipcRenderer.invoke('git:checkout', root, target, kind),
  gitBranchFrom: (root: string, name: string, from: string): Promise<void> => ipcRenderer.invoke('git:branch-from', root, name, from),
  gitDeleteBranch: (root: string, name: string, force: boolean, remote: boolean): Promise<void> => ipcRenderer.invoke('git:delete-branch', root, name, force, remote),
  gitRenameBranch: (root: string, from: string, to: string): Promise<void> => ipcRenderer.invoke('git:rename-branch', root, from, to),
  gitStashApply: (root: string, ref: string): Promise<void> => ipcRenderer.invoke('git:stashApply', root, ref),
  gitIgnore: (root: string, path: string): Promise<void> => ipcRenderer.invoke('git:ignore', root, path),
  gitFetch: (root: string): Promise<void> => ipcRenderer.invoke('git:fetch', root),
  gitMerge: (root: string, branch: string): Promise<OpResult> => ipcRenderer.invoke('git:merge', root, branch),
  gitRebase: (root: string, onto: string): Promise<OpResult> => ipcRenderer.invoke('git:rebase', root, onto),
  gitCherryPick: (root: string, sha: string): Promise<OpResult> => ipcRenderer.invoke('git:cherry-pick', root, sha),
  gitRevertCommit: (root: string, sha: string): Promise<OpResult> => ipcRenderer.invoke('git:revert-commit', root, sha),
  gitContinue: (root: string): Promise<OpResult> => ipcRenderer.invoke('git:continue', root),
  gitAbort: (root: string): Promise<void> => ipcRenderer.invoke('git:abort', root),
  gitInProgress: (root: string): Promise<string | null> => ipcRenderer.invoke('git:in-progress', root),
  gitResolve: (root: string, path: string, how: 'ours' | 'theirs' | 'mark'): Promise<void> => ipcRenderer.invoke('git:resolve', root, path, how),
  gitReset: (root: string, sha: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> => ipcRenderer.invoke('git:reset', root, sha, mode),
  gitTag: (root: string, name: string, sha: string): Promise<void> => ipcRenderer.invoke('git:tag', root, name, sha),
  gitDiffFiles: (root: string, ref: string): Promise<CommitFile[]> => ipcRenderer.invoke('git:diff-files', root, ref),
  gitStatus: (root: string): Promise<GitStatus | null> => ipcRenderer.invoke('git:status', root),
  gitHeadText: (root: string, path: string): Promise<string | null> => ipcRenderer.invoke('git:head-text', root, path),
  gitShow: (root: string, path: string): Promise<string> => ipcRenderer.invoke('git:show', root, path),
  gitBlame: (root: string, path: string): Promise<BlameLine[] | null> =>
    ipcRenderer.invoke('git:blame', root, path),
  gitBranches: (root: string): Promise<string[]> => ipcRenderer.invoke('git:branches', root),
  gitSwitch: (root: string, branch: string): Promise<void> => ipcRenderer.invoke('git:switch', root, branch),
  gitCreateBranch: (root: string, name: string): Promise<void> =>
    ipcRenderer.invoke('git:createBranch', root, name),
  gitPush: (root: string, force = false): Promise<void> => ipcRenderer.invoke('git:push', root, force),
  gitPull: (root: string, mode: 'ff-only' | 'merge' | 'rebase' = 'ff-only'): Promise<OpResult> => ipcRenderer.invoke('git:pull', root, mode),
  gitStashList: (root: string): Promise<StashEntry[]> => ipcRenderer.invoke('git:stashList', root),
  gitStashPush: (root: string, message: string): Promise<void> => ipcRenderer.invoke('git:stashPush', root, message),
  gitStashPop: (root: string, ref: string): Promise<void> => ipcRenderer.invoke('git:stashPop', root, ref),
  gitStashDrop: (root: string, ref: string): Promise<void> => ipcRenderer.invoke('git:stashDrop', root, ref),
  gitRevert: (root: string, path: string, kind: ChangeKind): Promise<void> =>
    ipcRenderer.invoke('git:revert', root, path, kind),
  gitDiffForCommit: (root: string, changes: { path: string; kind: ChangeKind }[]): Promise<string> => ipcRenderer.invoke('git:diff-for-commit', root, changes),
  gitCommit: (root: string, message: string, paths: string[], amend = false): Promise<void> => ipcRenderer.invoke('git:commit', root, message, paths, amend),
  debugLaunch: (cwd: string, cols: number, rows: number, spec: PtySpec, kind: DebugKind): Promise<number> =>
    ipcRenderer.invoke('debug:launch', cwd, cols, rows, spec, kind),
  debugSetBreakpoints: (path: string, lines: Breakpoint[]): Promise<void> =>
    ipcRenderer.invoke('debug:setBreakpoints', path, lines),
  debugControl: (cmd: 'resume' | 'stepOver' | 'stepInto' | 'stepOut' | 'pause'): Promise<void> =>
    ipcRenderer.invoke('debug:control', cmd),
  debugScopes: (frameId: number): Promise<DebugScope[]> => ipcRenderer.invoke('debug:scopes', frameId),
  debugVariables: (ref: number): Promise<DebugVar[]> => ipcRenderer.invoke('debug:variables', ref),
  debugEvaluate: (frameId: number, expression: string): Promise<DebugEval> =>
    ipcRenderer.invoke('debug:evaluate', frameId, expression),
  onDebugEvent: (cb: (evt: DebugEvent) => void): void => {
    ipcRenderer.on('debug:event', (_e, evt: DebugEvent) => cb(evt))
  },
  settingsLoad: (): Promise<LoadedUserData> => ipcRenderer.invoke('settings:load'),
  settingsSave: (text: string): Promise<void> => ipcRenderer.invoke('settings:save', text),
  stateSave: (text: string): Promise<void> => ipcRenderer.invoke('state:save', text),
  ensureCustomCss: (): Promise<string> => ipcRenderer.invoke('settings:ensureCss'),
  openThemesDir: (): Promise<string> => ipcRenderer.invoke('themes:openDir'),
  openSnippetsDir: (): Promise<string> => ipcRenderer.invoke('snippets:openDir'),
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('win:toggleFullscreen'),
  extensionsList: (): Promise<ExtensionInfo[]> => ipcRenderer.invoke('extensions:list'),
  /** Starts watching the project folder for changes made outside Forge (replacing any earlier watch). */
  watchRoot: (root: string): Promise<void> => ipcRenderer.invoke('fs:watch', root),
  onFsChanged: (cb: (change: FsChange) => void): void => {
    ipcRenderer.on('fs:changed', (_e, change: FsChange) => cb(change))
  },
  onFsWatchError: (cb: (message: string) => void): void => {
    ipcRenderer.on('fs:watchError', (_e, message: string) => cb(message))
  },
  openExtensionsDir: (): Promise<string> => ipcRenderer.invoke('extensions:openDir'),
  /** The window is closing: write anything pending, then call flushed(). */
  onFlush: (cb: () => void): void => {
    ipcRenderer.on('app:flush', () => cb())
  },
  flushed: (): void => ipcRenderer.send('app:flushed'),
  /** Colors for the native window buttons (Windows/Linux). */
  setTitleBar: (color: string, symbolColor: string): Promise<void> => ipcRenderer.invoke('win:titleBar', color, symbolColor),
  /** 1 = 100%. */
  setZoom: (factor: number): void => webFrame.setZoomFactor(factor),
  /** Each subscription returns a function that removes it. */
  onTermData: (cb: (id: number, data: string) => void): (() => void) => {
    const listener = (_e: unknown, id: number, data: string): void => cb(id, data)
    ipcRenderer.on('term:data', listener)
    return () => ipcRenderer.removeListener('term:data', listener)
  },
  onTermExit: (cb: (id: number, code: number) => void): (() => void) => {
    const listener = (_e: unknown, id: number, code: number): void => cb(id, code)
    ipcRenderer.on('term:exit', listener)
    return () => ipcRenderer.removeListener('term:exit', listener)
  }
}

contextBridge.exposeInMainWorld('forge', api)

export type ForgeApi = typeof api
