import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { buildGraph, findCycles, foldByFolder } from '../../src/main/depgraph'

const ROOT = process.platform === 'win32' ? 'C:\\proj' : '/proj'
const f = (rel: string, text: string): { path: string; text: string } => ({ path: join(ROOT, rel), text })
const edgeNames = (g: ReturnType<typeof buildGraph>): string[] => g.edges.map((e) => `${g.files[e.from]}>${g.files[e.to]}`).sort()

test('imports become edges between project files; packages and missing files do not', () => {
  const g = buildGraph(ROOT, [
    f('src/a.ts', "import { b } from './b'\nimport x from 'lodash'\nimport y from './missing'\nexport * from './sub'"),
    f('src/b.ts', "import c from './c.js'"),
    f('src/c.ts', ''),
    f('src/sub/index.ts', "import { a } from '../a'")
  ])
  assert.deepEqual(g.files, ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/sub/index.ts'])
  assert.deepEqual(edgeNames(g), ['src/a.ts>src/b.ts', 'src/a.ts>src/sub/index.ts', 'src/b.ts>src/c.ts', 'src/sub/index.ts>src/a.ts'])
})

test('other languages: CSS imports, C includes, Python relative imports', () => {
  const g = buildGraph(ROOT, [
    f('a.css', "@import './b.css';"),
    f('b.css', ''),
    f('m.c', '#include "m.h"'),
    f('m.h', ''),
    f('pkg/x.py', 'from .y import thing'),
    f('pkg/y.py', '')
  ])
  assert.deepEqual(edgeNames(g), ['a.css>b.css', 'm.c>m.h', 'pkg/x.py>pkg/y.py'])
})

test('a file importing itself, or the same file twice, is one edge or none', () => {
  const g = buildGraph(ROOT, [f('a.ts', "import './a'"), f('b.ts', "import './c'\nimport './c'"), f('c.ts', '')])
  assert.deepEqual(edgeNames(g), ['b.ts>c.ts'])
})

test('cycles: groups of files that import each other', () => {
  const g = buildGraph(ROOT, [
    f('a.ts', "import './b'"),
    f('b.ts', "import './c'"),
    f('c.ts', "import './a'"),
    f('d.ts', "import './a'"),
    f('e.ts', "import './f'"),
    f('f.ts', "import './e'"),
    f('g.ts', '')
  ])
  const cycles = findCycles(g).map((c) => c.map((i) => g.files[i]))
  assert.deepEqual(cycles, [['a.ts', 'b.ts', 'c.ts'], ['e.ts', 'f.ts']])
})

test('no cycles in a plain tree, and a long chain does not overflow the stack', () => {
  assert.deepEqual(findCycles(buildGraph(ROOT, [f('a.ts', "import './b'"), f('b.ts', '')])), [])
  const chain = Array.from({ length: 5000 }, (_, i) => f(`m${i}.ts`, `import './m${i + 1}'`))
  chain.push(f('m5000.ts', "import './m0'"))
  const cycles = findCycles(buildGraph(ROOT, chain))
  assert.equal(cycles.length, 1)
  assert.equal(cycles[0]?.length, 5001)
})

test('folding by folder counts imports between folders and drops those inside one', () => {
  const g = buildGraph(ROOT, [
    f('src/a/one.ts', "import '../b/two'\nimport './same'"),
    f('src/a/same.ts', ''),
    f('src/b/two.ts', ''),
    f('src/b/three.ts', "import '../a/one'"),
    f('src/a/four.ts', "import '../b/two'")
  ])
  const folded = foldByFolder(g, 2)
  assert.deepEqual(folded.folders, ['src/a', 'src/b'])
  assert.deepEqual(
    folded.edges.map((e) => `${folded.folders[e.from]}>${folded.folders[e.to]}:${e.count}`).sort(),
    ['src/a>src/b:2', 'src/b>src/a:1']
  )
})
