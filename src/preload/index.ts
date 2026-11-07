import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { DirEntry } from '../main/index'
import type { DapLaunch, DebugEvent, DebugEval, DebugKind, DebugScope, DebugVar } from '../main/debug'
import type { Breakpoint } from '../main/debug-types'
import type { SearchOptions, SearchResult } from '../main/search'
import type { FsChange } from '../main/watch'
import type { AiEvent, AiRequest } from '../main/ai'
import type { PtySpec } from '../main/terminal'
import type { RpcRequest, RpcResponse } from '../shared/rpc'

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', dir),
  listFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:listFiles', root),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  references: (root: string, target: string): Promise<{ hits: { file: string; line: number; text: string }[]; files: number; truncated: boolean }> =>
    ipcRenderer.invoke('fs:references', root, target),
  readBytes: (path: string, offset: number, length: number): Promise<{ data: Uint8Array; size: number }> => ipcRenderer.invoke('fs:readBytes', path, offset, length),
  readFileEnc: (path: string, encoding?: string): Promise<{ text: string; encoding: string }> => ipcRenderer.invoke('fs:readFileEnc', path, encoding),
  writeFileEnc: (path: string, content: string, encoding: string): Promise<void> => ipcRenderer.invoke('fs:writeFileEnc', path, content, encoding),
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
  lspConfigure: (servers: unknown): Promise<{ id: string; name: string; extensions: string[] }[]> => ipcRenderer.invoke('lsp:configure', servers),
  copy: (from: string, to: string): Promise<void> => ipcRenderer.invoke('fs:copy', from, to),
  createFile: (path: string): Promise<void> => ipcRenderer.invoke('fs:createFile', path),
  createDir: (path: string): Promise<void> => ipcRenderer.invoke('fs:createDir', path),
  rename: (from: string, to: string): Promise<void> => ipcRenderer.invoke('fs:rename', from, to),
  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  lspWorkspace: (root: string, method: string, params: unknown): Promise<{ server: string; result?: unknown; error?: string }[]> =>
    ipcRenderer.invoke('lsp:workspace', root, method, params),
  realpath: (path: string): Promise<string> => ipcRenderer.invoke('fs:realpath', path),
  trash: (path: string): Promise<void> => ipcRenderer.invoke('fs:trash', path),

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
                                                                                          debugLaunch: (cwd: string, cols: number, rows: number, spec: PtySpec, kind: DebugKind, dap?: DapLaunch): Promise<number> =>
    ipcRenderer.invoke('debug:launch', cwd, cols, rows, spec, kind, dap),
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
  settingsExport: (text: string): Promise<string | null> => ipcRenderer.invoke('settings:export', text),
  settingsImport: (): Promise<{ path: string; text: string } | null> => ipcRenderer.invoke('settings:import'),
  openThemesDir: (): Promise<string> => ipcRenderer.invoke('themes:openDir'),
  openSnippetsDir: (): Promise<string> => ipcRenderer.invoke('snippets:openDir'),
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('win:toggleFullscreen'),
  /** Starts watching the project folder for changes made outside Forge (replacing any earlier watch). */
  /** Typed backend services (see src/shared/rpc.ts and src/renderer/rpc.ts). */
  rpc: (req: RpcRequest): Promise<RpcResponse> => ipcRenderer.invoke('rpc:call', req),
  onRpcEvent: (cb: (topic: string, payload: unknown) => void): (() => void) => {
    const listener = (_e: unknown, topic: string, payload: unknown): void => cb(topic, payload)
    ipcRenderer.on('rpc:event', listener)
    return () => ipcRenderer.removeListener('rpc:event', listener)
  },
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
  setZoom: (factor: number): void => webFrame.setZoomFactor(factor)
}

contextBridge.exposeInMainWorld('forge', api)

export type ForgeApi = typeof api
