import assert from 'node:assert/strict'
import test from 'node:test'
import { client, RpcServer } from '../../src/shared/rpc'

class Calc {
  private secret = 7
  add(a: number, b: number): number { return a + b }
  async slow(): Promise<string> { return 'done' }
  fail(): never { throw new Error('nope') }
  _hidden(): number { return this.secret }
}
const server = new RpcServer(async (name) => {
  if (name !== 'calc') throw new Error(`No module provides the service "${name}"`)
  return new Calc()
})
const calc = client<Calc>('calc', (req) => server.dispatch(req))

test('calls reach the service and return values', async () => {
  assert.equal(await calc.add(2, 3), 5)
  assert.equal(await calc.slow(), 'done')
})

test('errors travel back as rejections with their message', async () => {
  await assert.rejects(calc.fail(), /nope/)
  await assert.rejects(client<Calc>('ghost', (r) => server.dispatch(r)).add(1, 2), /No module provides the service "ghost"/)
})

test('unknown, private and inherited methods are not callable', async () => {
  const bad = calc as unknown as Record<string, () => Promise<unknown>>
  await assert.rejects(bad['missing']!(), /has no method "missing"/)
  await assert.rejects(calc._hidden(), /is not callable/)
  await assert.rejects(bad['constructor']!(), /has no method "constructor"/)
  await assert.rejects(bad['toString']!(), /has no method "toString"/)
})

test('malformed requests are rejected, not thrown', async () => {
  const res = await server.dispatch({ service: 'calc', method: 'add', args: 'x' } as never)
  assert.deepEqual(res, { ok: false, error: 'Malformed RPC request' })
})
