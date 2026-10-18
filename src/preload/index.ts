import { contextBridge, ipcRenderer } from 'electron'
import type { DirEntry } from '../main/index'
import type { SearchResult } from '../main/search'

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', dir),
  listFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:listFiles', root),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', path, content),
  search: (root: string, query: string): Promise<SearchResult> =>
    ipcRenderer.invoke('fs:search', root, query),
  createFile: (path: string): Promise<void> => ipcRenderer.invoke('fs:createFile', path),
  createDir: (path: string): Promise<void> => ipcRenderer.invoke('fs:createDir', path),
  rename: (from: string, to: string): Promise<void> => ipcRenderer.invoke('fs:rename', from, to),
  trash: (path: string): Promise<void> => ipcRenderer.invoke('fs:trash', path),

  termCreate: (cwd: string, cols: number, rows: number): Promise<number> =>
    ipcRenderer.invoke('term:create', cwd, cols, rows),
  termWrite: (id: number, data: string): Promise<void> => ipcRenderer.invoke('term:write', id, data),
  termResize: (id: number, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('term:resize', id, cols, rows),
  termKill: (id: number): Promise<void> => ipcRenderer.invoke('term:kill', id),
  onTermData: (cb: (id: number, data: string) => void): void => {
    ipcRenderer.on('term:data', (_e, id: number, data: string) => cb(id, data))
  },
  onTermExit: (cb: (id: number, code: number) => void): void => {
    ipcRenderer.on('term:exit', (_e, id: number, code: number) => cb(id, code))
  }
}

contextBridge.exposeInMainWorld('forge', api)

export type ForgeApi = typeof api
