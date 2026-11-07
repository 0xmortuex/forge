import assert from 'node:assert/strict'
import test from 'node:test'
import { ModuleRegistry, type ModuleDescriptor } from '../../src/main/platform/modules'

const mod = (id: string, extra: Partial<ModuleDescriptor> = {}, log: string[] = []): ModuleDescriptor => ({
  id,
  activation: 'lazy',
  activate: () => {
    log.push(`+${id}`)
    return { services: Object.fromEntries((extra.provides ?? []).map((s) => [s, { name: s }])), dispose: () => void log.push(`-${id}`) }
  },
  ...extra
})

test('requires are activated first, once', async () => {
  const log: string[] = []
  const r = new ModuleRegistry()
  r.register(mod('a', { provides: ['A'] }, log))
  r.register(mod('b', { requires: ['a'], provides: ['B'] }, log))
  await r.service('B')
  await r.service('B')
  assert.deepEqual(log, ['+a', '+b'])
})

test('lazy modules stay inactive until asked; startup modules activate in startup()', async () => {
  const log: string[] = []
  const r = new ModuleRegistry()
  r.register(mod('eager', { activation: 'startup' }, log))
  r.register(mod('lazy', { provides: ['L'] }, log))
  await r.startup()
  assert.deepEqual(log, ['+eager'])
  assert.equal(r.isActive('lazy'), false)
})

test('concurrent requests share one activation', async () => {
  let n = 0
  const r = new ModuleRegistry()
  r.register({ id: 'slow', activation: 'lazy', provides: ['S'], activate: async () => { n++; await new Promise((ok) => setTimeout(ok, 10)); return { services: { S: {} } } } })
  await Promise.all([r.service('S'), r.service('S'), r.service('S')])
  assert.equal(n, 1)
})

test('a dependency cycle is reported with its path', async () => {
  const r = new ModuleRegistry()
  r.register(mod('x', { requires: ['y'] }))
  r.register(mod('y', { requires: ['x'] }))
  await assert.rejects(r.activate('x'), /Circular module dependency: x -> y -> x/)
})

test('unknown module, unknown service and duplicate registrations are errors', async () => {
  const r = new ModuleRegistry()
  r.register(mod('a', { requires: ['ghost'] }))
  await assert.rejects(r.activate('a'), /Unknown module "ghost" \(required by "a"\)/)
  await assert.rejects(r.service('nope'), /No module provides the service "nope"/)
  assert.throws(() => r.register(mod('a')), /already registered/)
  r.register(mod('p', { provides: ['P'] }))
  assert.throws(() => r.register(mod('q', { provides: ['P'] })), /provided by both "p" and "q"/)
})

test('a module may not use a service whose provider it did not list in requires', async () => {
  const r = new ModuleRegistry()
  r.register(mod('a', { provides: ['A'] }))
  r.register({ id: 'sneaky', activation: 'lazy', provides: ['S'], activate: async (ctx) => { await ctx.service('A'); return { services: { S: {} } } } })
  await assert.rejects(r.service('S'), /without listing its provider in "requires"/)
})

test('a declared service that is not returned is an error', async () => {
  const r = new ModuleRegistry()
  r.register({ id: 'liar', activation: 'lazy', provides: ['L'], activate: () => ({}) })
  await assert.rejects(r.service('L'), /declared the service "L" but did not return it/)
})

test('failed activation is not cached: the next request tries again', async () => {
  let fail = true
  const r = new ModuleRegistry()
  r.register({ id: 'flaky', activation: 'lazy', provides: ['F'], activate: () => { if (fail) throw new Error('boom'); return { services: { F: {} } } } })
  await assert.rejects(r.service('F'), /boom/)
  fail = false
  await r.service('F')
})

test('unload is vetoed by active dependents unless cascading, and the module can activate again', async () => {
  const log: string[] = []
  const r = new ModuleRegistry()
  r.register(mod('a', { provides: ['A'] }, log))
  r.register(mod('b', { requires: ['a'], provides: ['B'] }, log))
  await r.service('B')
  await assert.rejects(r.unload('a'), /still required by "b"/)
  await r.unload('a', { cascade: true })
  assert.deepEqual(log, ['+a', '+b', '-b', '-a'])
  await r.service('A')
  assert.equal(r.isActive('a'), true)
})

test('shutdown disposes dependents before dependencies', async () => {
  const log: string[] = []
  const r = new ModuleRegistry()
  r.register(mod('a', { provides: ['A'] }, log))
  r.register(mod('b', { requires: ['a'], provides: ['B'] }, log))
  await r.service('B')
  await r.shutdown()
  assert.deepEqual(log.slice(2), ['-b', '-a'])
})

test('bus: a failing subscriber does not stop the others, and its error is raised', () => {
  const r = new ModuleRegistry()
  const seen: unknown[] = []
  r.bus.subscribe('t', () => { throw new Error('bad') })
  r.bus.subscribe('t', (p) => void seen.push(p))
  assert.throws(() => r.bus.publish('t', 1), /Subscribers of "t" failed/)
  assert.deepEqual(seen, [1])
})
