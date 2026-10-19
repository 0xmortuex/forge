import assert from 'node:assert/strict'
import test from 'node:test'
import { findDuplicateGroups, normalize } from '../../src/main/duplicates'

const file = (path: string, text: string): { path: string; norm: ReturnType<typeof normalize> } => ({ path, norm: normalize(text) })

const BLOCK = ['function total(items) {', '  let sum = 0', '  for (const i of items) {', '    sum += i.price * i.qty', '  }', '  return sum', '}'].join('\n')

test('normalize drops blank, brace-only and comment-only lines and keeps real line numbers', () => {
  const n = normalize('// header\n\nfoo()\n  }\n  bar(1,   2)\n/* c */\n')
  assert.deepEqual(n.lines, ['foo()', 'bar(1, 2)'])
  assert.deepEqual(n.numbers, [3, 5])
})

test('normalize keeps lines that merely start with a hash or star when they are code', () => {
  const n = normalize('#include <stdio.h>\n*p = 1\n# a note\n')
  assert.deepEqual(n.lines, ['#include <stdio.h>', '*p = 1'])
})

test('a block copied into two files is one group with both places', () => {
  const a = file('a.js', `const A = 1\n${BLOCK}\nexport const x = A`)
  const b = file('b.js', `const B = 2\n${BLOCK}\nexport const y = B`)
  const { groups } = findDuplicateGroups([a, b], 5)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.occurrences.length, 2)
  assert.equal(groups[0]?.lines, 5) // the 7 lines of BLOCK, minus the two lone closing braces
  assert.deepEqual(groups[0]?.occurrences.map((o) => o.path), ['a.js', 'b.js'])
})

test('the block is grown to the longest part the copies share, and reported once', () => {
  const a = file('a.js', `${BLOCK}\nextraA()\n`)
  const b = file('b.js', `${BLOCK}\nextraB()\n`)
  const { groups } = findDuplicateGroups([a, b], 3)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.lines, 5)
})

test('three copies are one group of three', () => {
  const files = ['a', 'b', 'c'].map((n) => file(`${n}.js`, `const ${n} = 1\n${BLOCK}\nafter_${n}()`))
  const { groups } = findDuplicateGroups(files, 5)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.occurrences.length, 3)
})

test('line numbers point at the real lines of each copy', () => {
  const a = file('a.js', `one()\n\n\n${BLOCK}\n`) // BLOCK starts on line 4
  const b = file('b.js', `${BLOCK}\n`) // BLOCK starts on line 1
  const [g] = findDuplicateGroups([a, b], 5).groups
  const byPath = Object.fromEntries((g?.occurrences ?? []).map((o) => [o.path, o]))
  assert.equal(byPath['a.js']?.startLine, 4)
  assert.equal(byPath['b.js']?.startLine, 1)
})

test('short repeats are not duplicates', () => {
  const a = file('a.js', 'foo()\nbar()\nbaz()\n')
  const b = file('b.js', 'foo()\nbar()\nbaz()\n')
  assert.equal(findDuplicateGroups([a, b], 6).groups.length, 0)
})

test('a block repeated inside one file counts, but a block cannot overlap itself', () => {
  const repeated = Array.from({ length: 4 }, () => 'step1()\nstep2()\nstep3()').join('\n')
  const { groups } = findDuplicateGroups([file('a.js', repeated)], 3)
  assert.equal(groups.length, 1)
  // Every copy must be a distinct stretch of the file.
  const spans = groups[0]!.occurrences
  for (const x of spans) for (const y of spans) if (x !== y) assert.ok(x.endLine < y.startLine || y.endLine < x.startLine)
})

test('files with nothing in common produce no groups', () => {
  const a = file('a.js', 'a1()\na2()\na3()\na4()\na5()\na6()\n')
  const b = file('b.js', 'b1()\nb2()\nb3()\nb4()\nb5()\nb6()\n')
  assert.equal(findDuplicateGroups([a, b], 3).groups.length, 0)
})
