import assert from 'node:assert/strict'
import test from 'node:test'
import { WebSocket } from 'ws'
import { ModuleRegistry } from '../../src/main/platform/modules'
import { connectWs, startWsServer, type WsServerHandle } from '../../src/main/platform/ws'
import { client, RpcServer } from '../../src/shared/rpc'

class Calc {
  add(a: number, b: number): number {
    return a + b
  }
  fail(): never {
    throw new Error('nope')
  }
}

async function setup(): Promise<{ registry: ModuleRegistry; handle: WsServerHandle; url: string; done: () => Promise<void> }> {
  const registry = new ModuleRegistry()
  registry.register({ id: 'calc', activation: 'lazy', provides: ['calc'], activate: () => ({ services: { calc: new Calc() } }) })
  const handle = await startWsServer(new RpcServer((n) => registry.service(n)), registry.bus)
  return { registry, handle, url: `ws://${handle.host}:${handle.port}`, done: () => handle.close() }
}

/** What happens on connecting: the HTTP status of a refused upgrade, or "open". */
const attempt = (url: string, opts: { token?: string; origin?: string }): Promise<string> =>
  new Promise((ok) => {
    const headers: Record<string, string> = {}
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
    const s = new WebSocket(url, { headers, origin: opts.origin })
    s.once('unexpected-response', (_r, res) => ok(`HTTP ${res.statusCode}`))
    s.once('open', () => {
      ok('open')
      s.close()
    })
    s.once('error', (e) => ok(`error ${e.message}`))
  })

test('typed calls and errors work over the socket like they do over IPC', async () => {
  const s = await setup()
  try {
    const conn = await connectWs(s.url, s.handle.token)
    const calc = client<Calc>('calc', conn.invoke)
    assert.equal(await calc.add(2, 3), 5)
    await assert.rejects(calc.fail(), /nope/)
    await assert.rejects(client<Calc>('ghost', conn.invoke).add(1, 1), /No module provides the service "ghost"/)
    conn.close()
  } finally {
    await s.done()
  }
})

test('bus events reach connected clients, and stop after unsubscribing', async () => {
  const s = await setup()
  try {
    const conn = await connectWs(s.url, s.handle.token)
    const seen: unknown[] = []
    const off = conn.onEvent((topic, payload) => void seen.push([topic, payload]))
    s.registry.bus.publish('term.data', { id: 1, data: 'x' })
    await new Promise((ok) => setTimeout(ok, 100))
    off()
    s.registry.bus.publish('term.data', { id: 1, data: 'y' })
    await new Promise((ok) => setTimeout(ok, 100))
    assert.deepEqual(seen, [['term.data', { id: 1, data: 'x' }]])
    conn.close()
  } finally {
    await s.done()
  }
})

test('the server listens on loopback only, with a 256-bit token', async () => {
  const s = await setup()
  try {
    assert.equal(s.handle.host, '127.0.0.1')
    assert.equal(s.handle.token.length, 64)
  } finally {
    await s.done()
  }
})

test('a missing or wrong token is refused with 401', async () => {
  const s = await setup()
  try {
    assert.equal(await attempt(s.url, {}), 'HTTP 401')
    assert.equal(await attempt(s.url, { token: 'a'.repeat(64) }), 'HTTP 401')
    assert.equal(await attempt(s.url, { token: s.handle.token }), 'open')
    await assert.rejects(connectWs(s.url, 'wrong'), /HTTP 401/)
  } finally {
    await s.done()
  }
})

test('a browser origin is refused even with the right token', async () => {
  const s = await setup()
  try {
    assert.equal(await attempt(s.url, { token: s.handle.token, origin: 'https://evil.example' }), 'HTTP 403')
  } finally {
    await s.done()
  }
})

test('a malformed message closes the connection with 1003', async () => {
  const s = await setup()
  try {
    const raw = new WebSocket(s.url, { headers: { Authorization: `Bearer ${s.handle.token}` } })
    await new Promise((ok) => raw.once('open', ok))
    const closed = new Promise<number>((ok) => raw.once('close', (code) => ok(code)))
    raw.send('this is not json')
    assert.equal(await closed, 1003)
  } finally {
    await s.done()
  }
})

test('closing the server makes later calls fail with a clear error', async () => {
  const s = await setup()
  const conn = await connectWs(s.url, s.handle.token)
  await s.done()
  await new Promise((ok) => setTimeout(ok, 100))
  await assert.rejects(client<Calc>('calc', conn.invoke).add(1, 2), /Connection (closed|is not open)/)
})
