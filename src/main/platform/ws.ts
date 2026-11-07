import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import type { Invoke, RpcRequest, RpcResponse, RpcServer } from '../../shared/rpc'
import type { Bus } from './modules'

// The RPC protocol over a WebSocket, so a UI in another process (or machine, behind a tunnel) can use the same services.
//   client -> server: { id, req: RpcRequest }
//   server -> client: { id, res: RpcResponse }  or  { event: topic, payload }
//
// Every service is reachable through this, the terminal included, so it is deliberately hard to misuse:
// loopback only, a random token in the Authorization header, and any browser Origin is refused (a web page must
// not be able to connect). Nothing starts it automatically.

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024

export interface WsServerHandle {
  host: string
  port: number
  token: string
  /** Disconnects everyone and stops listening. */
  close(): Promise<void>
}

export async function startWsServer(rpc: RpcServer, bus: Bus, opts: { port?: number } = {}): Promise<WsServerHandle> {
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const host = '127.0.0.1'

  const wss = new WebSocketServer({
    host,
    port: opts.port ?? 0,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: (info, done) => {
      if (info.origin) return done(false, 403, 'Browser origins are not allowed')
      const given = Buffer.from(String(info.req.headers['authorization'] ?? ''))
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return done(false, 401, 'Bad token')
      done(true)
    }
  })
  await new Promise<void>((ok, fail) => {
    wss.once('listening', () => ok())
    wss.once('error', fail)
  })

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let msg: { id?: unknown; req?: unknown }
      try {
        msg = JSON.parse(raw.toString()) as typeof msg
      } catch {
        return socket.close(1003, 'Messages must be JSON')
      }
      if (typeof msg.id !== 'number' || typeof msg.req !== 'object' || msg.req === null) return socket.close(1003, 'Malformed request')
      const id = msg.id
      void rpc.dispatch(msg.req as RpcRequest).then((res) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, res }))
      })
    })
  })

  const stopForwarding = bus.tap((topic, payload) => {
    const text = JSON.stringify({ event: topic, payload })
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(text)
  })

  return {
    host,
    port: (wss.address() as AddressInfo).port,
    token,
    close: () =>
      new Promise<void>((ok, fail) => {
        stopForwarding()
        for (const c of wss.clients) c.terminate()
        wss.close((err) => (err ? fail(err) : ok()))
      })
  }
}

export interface WsConnection {
  invoke: Invoke
  /** Bus events from the server. Returns a function that stops listening. */
  onEvent(cb: (topic: string, payload: unknown) => void): () => void
  close(): void
}

export function connectWs(url: string, token: string): Promise<WsConnection> {
  return new Promise((ok, fail) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, maxPayload: MAX_MESSAGE_BYTES })
    const pending = new Map<number, { resolve: (r: RpcResponse) => void; reject: (e: Error) => void }>()
    const listeners = new Set<(topic: string, payload: unknown) => void>()
    let next = 1
    let closedWith: string | null = null

    socket.once('unexpected-response', (_req, res) => fail(new Error(`Server refused the connection: HTTP ${res.statusCode}`)))
    socket.once('error', fail)
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: number; res?: RpcResponse; event?: string; payload?: unknown }
      if (typeof msg.id === 'number' && msg.res) {
        pending.get(msg.id)?.resolve(msg.res)
        pending.delete(msg.id)
      } else if (typeof msg.event === 'string') for (const cb of [...listeners]) cb(msg.event, msg.payload)
    })
    socket.on('close', (code, reason) => {
      closedWith = `closed (${code}${reason.length ? `: ${reason.toString()}` : ''})`
      for (const p of pending.values()) p.reject(new Error(`Connection ${closedWith}`))
      pending.clear()
    })
    socket.once('open', () =>
      ok({
        invoke: (req) =>
          new Promise<RpcResponse>((resolve, reject) => {
            if (closedWith || socket.readyState !== WebSocket.OPEN) return reject(new Error(`Connection ${closedWith ?? 'is not open'}`))
            const id = next++
            pending.set(id, { resolve, reject })
            socket.send(JSON.stringify({ id, req }))
          }),
        onEvent: (cb) => {
          listeners.add(cb)
          return () => void listeners.delete(cb)
        },
        close: () => socket.close()
      })
    )
  })
}
