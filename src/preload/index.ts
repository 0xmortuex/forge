import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { DapLaunch, DebugEvent, DebugEval, DebugKind, DebugScope, DebugVar } from '../main/debug'
import type { Breakpoint } from '../main/debug-types'
import type { AiEvent, AiRequest } from '../main/ai'
import type { PtySpec } from '../main/terminal'
import type { RpcRequest, RpcResponse } from '../shared/rpc'

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
                      /** Shows the file in Explorer / Finder. */
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('shell:reveal', path),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
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
            readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
      trash: (path: string): Promise<void> => ipcRenderer.invoke('fs:trash', path),

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
