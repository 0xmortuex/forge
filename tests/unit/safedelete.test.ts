import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pointsAt, referencesTo } from '../../src/main/safedelete'

const P = (...parts: string[]): string => join(process.platform === 'win32' ? 'C:\\proj' : '/proj', ...parts)

test('JS/TS imports of a file, with or without the extension', () => {
  const target = P('src', 'util.ts')
  const from = P('src', 'main.ts')
  const refs = referencesTo(target, false, from, ["import { a } from './util'", "const b = require('./util.ts')", "import('./util')", "import x from 'util'", "import y from './other'"].join('\n'))
  assert.deepEqual(refs.map((r) => r.line), [1, 2, 3])
})

test('a folder import resolves to its index file, and ../ climbs', () => {
  assert.equal(referencesTo(P('src', 'lib', 'index.ts'), false, P('src', 'main.ts'), "import l from './lib'").length, 1)
  assert.equal(referencesTo(P('src', 'util.ts'), false, P('src', 'deep', 'x.ts'), "export * from '../util'").length, 1)
  assert.equal(referencesTo(P('src', 'util.ts'), false, P('src', 'deep', 'x.ts'), "import a from './util'").length, 0, 'a different ./util')
})

test('deleting a folder counts everything that points into it', () => {
  const dir = P('src', 'lib')
  const from = P('src', 'main.ts')
  assert.equal(referencesTo(dir, true, from, "import a from './lib/a'\nimport b from './lib'\nimport c from './libx'").length, 2)
})

test('CSS, C, HTML and Markdown references', () => {
  assert.equal(referencesTo(P('a', 'theme.css'), false, P('a', 'main.css'), "@import './theme.css';\nbody { background: url(img.png) }").length, 1)
  assert.equal(referencesTo(P('a', 'img.png'), false, P('a', 'main.css'), 'body { background: url("img.png") }').length, 1)
  assert.equal(referencesTo(P('inc', 'x.h'), false, P('inc', 'x.c'), '#include "x.h"\n#include <stdio.h>').length, 1)
  assert.equal(referencesTo(P('site', 'app.js'), false, P('site', 'index.html'), '<script src="app.js"></script>').length, 1)
  assert.equal(referencesTo(P('docs', 'guide.md'), false, P('docs', 'README.md'), 'See [the guide](guide.md#intro) or [web](https://x.y/guide.md)').length, 1)
})

test('Python relative imports', () => {
  assert.equal(referencesTo(P('pkg', 'mod.py'), false, P('pkg', 'main.py'), 'from .mod import thing').length, 1)
  assert.equal(referencesTo(P('pkg', 'mod.py'), false, P('pkg', 'sub', 'x.py'), 'from ..mod import thing').length, 1)
  assert.equal(referencesTo(P('pkg', 'mod.py'), false, P('pkg', 'main.py'), 'from . import mod, other').length, 1)
})

test('URLs, anchors and packages never match', () => {
  assert.equal(pointsAt('https://x.y/util.ts', P('a.ts'), P('util.ts'), false), false)
  assert.equal(referencesTo(P('util.ts'), false, P('main.html'), '<a href="#util">x</a>\n<a href="/util">y</a>').length, 0)
})

test('returns the line number and the trimmed text', () => {
  const refs = referencesTo(P('u.ts'), false, P('m.ts'), "\n\n   import u from './u'   ")
  assert.deepEqual(refs, [{ line: 3, text: "import u from './u'" }])
})
