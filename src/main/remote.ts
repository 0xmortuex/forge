import { BrowserWindow, dialog } from 'electron'
import type { RpcServer } from '../shared/rpc'
import type { Bus } from './platform/modules'
import { startWsServer, type WsServerHandle } from './platform/ws'

// Lets another program use this Forge's backend over a WebSocket (see platform/ws.ts). Everything is opt-in:
// nothing starts it but the "Start Remote Backend" command, and the confirmation below is a native dialog shown by this
// process, so the page cannot answer it or skip it.

export interface RemoteInfo {
  /** Where to connect, e.g. ws://127.0.0.1:51234 */
  url: string
  /** Sent as "Authorization: Bearer <token>"; new for every start. */
  token: string
}

export interface RemoteApi {
  start(): Promise<RemoteInfo>
  stop(): Promise<void>
  status(): Promise<RemoteInfo | null>
}

let handle: WsServerHandle | null = null
let starting: Promise<RemoteInfo> | null = null

const info = (h: WsServerHandle): RemoteInfo => ({ url: `ws://${h.host}:${h.port}`, token: h.token })

/** Used when the app quits. */
export async function stopRemoteServer(): Promise<void> {
  const h = handle
  handle = null
  await h?.close()
}

/** Provided as the "remote" service (see platform). */
export class RemoteService implements RemoteApi {
  constructor(
    private readonly rpc: RpcServer,
    private readonly bus: Bus
  ) {}

  start(): Promise<RemoteInfo> {
    if (handle) return Promise.resolve(info(handle))
    starting ??= this.confirmAndStart().finally(() => (starting = null)) // two quick calls must not show two dialogs
    return starting
  }

  private async confirmAndStart(): Promise<RemoteInfo> {
    const options = {
      type: 'warning' as const,
      title: 'Start Remote Backend',
      message: 'Let another program use this Forge?',
      detail:
        'Anything that connects with the token can read and change every file of the open project, run commands in the terminal ' +
        'and use your git credentials, as if it were you. It can only connect from this computer (127.0.0.1) and needs a token ' +
        'that is created now and copied to your clipboard. It stops when you choose Stop Remote Backend or quit Forge.\n\n' +
        'Only continue if you started this yourself.',
      buttons: ['Start', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    }
    const win = BrowserWindow.getFocusedWindow()
    const answer = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (answer.response !== 0) throw new Error('Starting the remote backend was cancelled')
    handle = await startWsServer(this.rpc, this.bus)
    return info(handle)
  }

  stop(): Promise<void> {
    return stopRemoteServer()
  }

  async status(): Promise<RemoteInfo | null> {
    return handle ? info(handle) : null
  }
}
