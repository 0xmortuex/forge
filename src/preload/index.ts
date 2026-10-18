import { contextBridge, ipcRenderer } from 'electron'
import type { DirEntry } from '../main/index'
import type { BlameLine, GitStatus } from '../main/git'
import type { SearchResult } from '../main/search'
import type { PtySpec } from '../main/terminal'

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', dir),
  listFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:listFiles', root),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', path, content),
  search: (root: string, query: string): Promise<SearchResult> =>
    ipcRenderer.invoke('fs:search', root, query),
  exists: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', path),
  createFile: (path: string): Promise<void> => ipcRenderer.invoke('fs:createFile', path),
  createDir: (path: string): Promise<void> => ipcRenderer.invoke('fs:createDir', path),
  rename: (from: string, to: string): Promise<void> => ipcRenderer.invoke('fs:rename', from, to),
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
  onLspDiagnostics: (cb: (uri: string, diagnostics: unknown[]) => void): void => {
    ipcRenderer.on('lsp:diagnostics', (_e, uri: string, diagnostics: unknown[]) => cb(uri, diagnostics))
  },
  onLspLog: (cb: (server: string, type: number, message: string) => void): void => {
    ipcRenderer.on('lsp:log', (_e, server: string, type: number, message: string) => cb(server, type, message))
  },
  gitStatus: (root: string): Promise<GitStatus | null> => ipcRenderer.invoke('git:status', root),
  gitShow: (root: string, path: string): Promise<string> => ipcRenderer.invoke('git:show', root, path),
  gitBlame: (root: string, path: string): Promise<BlameLine[] | null> =>
    ipcRenderer.invoke('git:blame', root, path),
  gitBranches: (root: string): Promise<string[]> => ipcRenderer.invoke('git:branches', root),
  gitSwitch: (root: string, branch: string): Promise<void> => ipcRenderer.invoke('git:switch', root, branch),
  gitCreateBranch: (root: string, name: string): Promise<void> =>
    ipcRenderer.invoke('git:createBranch', root, name),
  gitCommit: (root: string, message: string, paths: string[]): Promise<void> =>
    ipcRenderer.invoke('git:commit', root, message, paths),
  onTermData: (cb: (id: number, data: string) => void): void => {
    ipcRenderer.on('term:data', (_e, id: number, data: string) => cb(id, data))
  },
  onTermExit: (cb: (id: number, code: number) => void): void => {
    ipcRenderer.on('term:exit', (_e, id: number, code: number) => cb(id, code))
  }
}

contextBridge.exposeInMainWorld('forge', api)

export type ForgeApi = typeof api
