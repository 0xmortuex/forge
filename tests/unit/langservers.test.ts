import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_DEFS, customDefs } from '../../src/main/langservers'

const ok = { id: 'my-ls', command: 'my-ls', extensions: ['.my'] }

test('a valid entry becomes a server definition', () => {
  const [d] = customDefs([{ ...ok, name: 'My', args: ['--stdio'], languageId: 'mylang' }], [])
  assert.equal(d?.id, 'my-ls')
  assert.equal(d?.name, 'My')
  assert.deepEqual(d?.extensions, { '.my': 'mylang' })
  assert.deepEqual(d?.commands, [{ command: 'my-ls', args: ['--stdio'] }])
})

test('the language id defaults to the id, and the name too', () => {
  const [d] = customDefs([ok], [])
  assert.deepEqual(d?.extensions, { '.my': 'my-ls' })
  assert.equal(d?.name, 'my-ls')
})

test('nothing or null is an empty list', () => {
  assert.deepEqual(customDefs(undefined, []), [])
  assert.deepEqual(customDefs(null, []), [])
})

test('mistakes name the entry and the reason', () => {
  assert.throws(() => customDefs('x', []), /must be a list/)
  assert.throws(() => customDefs([ok, { id: 'b', extensions: ['.b'] }], []), /languageServers\[1\]\.command must be the program/)
  assert.throws(() => customDefs([{ ...ok, id: 'Bad Id' }], []), /languageServers\[0\]\.id must be lowercase/)
  assert.throws(() => customDefs([{ ...ok, extensions: ['my'] }], []), /extensions must be a list of file extensions/)
  assert.throws(() => customDefs([{ ...ok, extensions: [] }], []), /extensions must be a list/)
  assert.throws(() => customDefs([{ ...ok, args: 'x' }], []), /args must be a list of strings/)
  assert.throws(() => customDefs([42], []), /must be an object/)
})

test('an id cannot repeat a built-in server or another entry', () => {
  assert.throws(() => customDefs([ok], ['my-ls']), /already used/)
  assert.throws(() => customDefs([ok, { ...ok, extensions: ['.other'] }], []), /already used/)
})

test('extensions are lowercased', () => {
  const [d] = customDefs([{ ...ok, extensions: ['.MY'] }], [])
  assert.deepEqual(Object.keys(d?.extensions ?? {}), ['.my'])
})

test('the built-in definitions are consistent', () => {
  const ids = new Set<string>()
  const exts = new Map<string, string>()
  for (const d of BUILTIN_DEFS) {
    assert.ok(!ids.has(d.id), `duplicate id ${d.id}`)
    ids.add(d.id)
    assert.ok(d.bundled || d.commands?.length, `${d.id} cannot be started`)
    assert.ok(Object.keys(d.extensions).length || Object.keys(d.names ?? {}).length, `${d.id} handles no files`)
    for (const e of Object.keys(d.extensions)) {
      assert.match(e, /^\.[a-z0-9]+$/, `${d.id}: bad extension ${e}`)
      assert.ok(!exts.has(e), `${e} is claimed by both ${exts.get(e)} and ${d.id}`)
      exts.set(e, d.id)
    }
    if (!d.bundled) assert.ok(d.install, `${d.id} says nothing about how to install it`)
  }
})
