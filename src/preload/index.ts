import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { RpcRequest, RpcResponse } from '../shared/rpc'

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
                      /** Shows the file in Explorer / Finder. */
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
      openInBrowser: (path: string): Promise<void> => ipcRenderer.invoke('shell:openInBrowser', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
                          readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
      trash: (path: string): Promise<void> => ipcRenderer.invoke('fs:trash', path),

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
