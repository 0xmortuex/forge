import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_INDEXED_BYTES, MIN_QUERY, TextIndex } from '../../src/main/platform/textindex'

const files: Record<string, string> = {
  '/p/a.ts': 'export function Hello() {\n  return "world"\n}\n',
  '/p/b.ts': 'const hello = 1\nconst other = 2\n',
  '/p/c.md': 'nothing relevant here\r\nsecond line\r\n'
}
const read = async (p: string): Promise<string> => {
  const t = files[p]
  if (t === undefined) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
  return t
}
const build = (): TextIndex => {
  const ix = new TextIndex()
  for (const [p, t] of Object.entries(files)) ix.add(p, t)
  return ix
}

test('finds every line that contains the text, case-insensitively, with 1-based line numbers', async () => {
  const hits = await build().search('hello', 10, read)
  assert.deepEqual(hits.map((h) => `${h.path}:${h.line}`), ['/p/a.ts:1', '/p/b.ts:1'])
  assert.equal(hits[0]?.text, 'export function Hello() {')
})

test('only files that contain every trigram of the query are even read', () => {
  const ix = build()
  assert.deepEqual(ix.candidates('hello'), ['/p/a.ts', '/p/b.ts'])
  assert.deepEqual(ix.candidates('second line'), ['/p/c.md'])
  assert.deepEqual(ix.candidates('zzzzzz'), [])
})

test('a candidate that does not really contain the text (trigrams are scattered) is filtered out', async () => {
  const ix = new TextIndex()
  ix.add('/x', 'abcd and bcde')
  assert.deepEqual(ix.candidates('abcde'), ['/x'], 'the trigrams abc, bcd and cde are all present')
  assert.deepEqual(await ix.search('abcde', 5, async () => 'abcd and bcde'), [], 'but the string itself is not')
})

test('a query shorter than three characters is an error, not an empty result', () => {
  assert.throws(() => build().candidates('he'), new RegExp(`at least ${MIN_QUERY} characters`))
})

test('limit stops the search', async () => {
  const hits = await build().search('const', 1, read)
  assert.equal(hits.length, 1)
})

test('re-adding a file replaces its old text; remove drops it', async () => {
  const ix = build()
  ix.add('/p/a.ts', 'now about banana')
  assert.deepEqual(ix.candidates('hello'), ['/p/b.ts'])
  assert.deepEqual(ix.candidates('banana'), ['/p/a.ts'])
  ix.remove('/p/a.ts')
  assert.deepEqual(ix.candidates('banana'), [])
  assert.equal(ix.has('/p/a.ts'), false)
})

test('removeTree drops a folder and everything in it, but not a sibling with a similar name', () => {
  const ix = new TextIndex()
  ix.add('/p/dir/one.ts', 'shared text')
  ix.add('/p/dir/sub/two.ts', 'shared text')
  ix.add('/p/dir2/three.ts', 'shared text')
  ix.removeTree('/p/dir', '/')
  assert.deepEqual(ix.candidates('shared'), ['/p/dir2/three.ts'])
})

test('binary and oversized files are reported as skipped, not indexed', () => {
  const ix = new TextIndex()
  assert.equal(ix.add('/bin', 'abc\0def'), 'binary')
  assert.equal(ix.add('/big', 'x'.repeat(MAX_INDEXED_BYTES + 1)), 'too-large')
  assert.equal(ix.add('/ok', 'fine'), null)
  assert.equal(ix.size, 1)
})

test('a file deleted since it was indexed is skipped, any other read error is raised', async () => {
  const ix = build()
  const gone = await ix.search('hello', 10, async (p) => {
    if (p === '/p/a.ts') throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    return read(p)
  })
  assert.deepEqual(gone.map((h) => h.path), ['/p/b.ts'])
  await assert.rejects(
    ix.search('hello', 10, async () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    }),
    /denied/
  )
})
