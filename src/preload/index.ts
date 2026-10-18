import { contextBridge, ipcRenderer } from 'electron'
import type { DirEntry } from '../main/index'

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDir: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readDir', dir),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', path, content)
}

contextBridge.exposeInMainWorld('forge', api)

export type ForgeApi = typeof api
