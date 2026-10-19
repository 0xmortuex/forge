import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPatch, changedIndices, parseDiff } from '../../src/main/gitpatch'

const DIFF = [
  'diff --git a/f.txt b/f.txt',
  'index 111..222 100644',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,5 +1,5 @@ top',
  ' one',
  '-two',
  '+TWO',
  ' three',
  ' four',
  ' five',
  '@@ -20,3 +20,4 @@ later',
  ' twenty',
  '+inserted',
  ' twentyone',
  ' twentytwo',
  ''
].join('\n')

test('parseDiff reads the header, hunks and lines', () => {
  const d = parseDiff(DIFF)
  assert.ok(d)
  assert.equal(d.header.length, 4)
  assert.equal(d.hunks.length, 2)
  assert.equal(d.hunks[0]?.oldStart, 1)
  assert.equal(d.hunks[0]?.context, ' top')
  assert.deepEqual(d.hunks[0]?.lines.map((l) => l.kind), [' ', '-', '+', ' ', ' ', ' '])
  assert.equal(d.hunks[1]?.newLines, 4)
})

test('parseDiff returns null when there is nothing to choose from', () => {
  assert.equal(parseDiff('Binary files a/x and b/x differ\n'), null)
  assert.equal(parseDiff(''), null)
})

test('the fingerprint changes when the diff does', () => {
  assert.notEqual(parseDiff(DIFF)?.fingerprint, parseDiff(DIFF.replace('+TWO', '+Two'))?.fingerprint)
  assert.equal(parseDiff(DIFF)?.fingerprint, parseDiff(DIFF)?.fingerprint)
})

test('changedIndices lists only added and removed lines', () => {
  const d = parseDiff(DIFF)
  assert.deepEqual(changedIndices(d!.hunks[0]!), [1, 2])
})

test('choosing everything gives back the same changes', () => {
  const d = parseDiff(DIFF)!
  const patch = buildPatch(d, [[1, 2], [1]])
  assert.match(patch, /@@ -1,5 \+1,5 @@ top/)
  assert.match(patch, /@@ -20,3 \+20,4 @@ later/)
  assert.ok(patch.includes('-two\n+TWO\n'))
  assert.ok(patch.includes('+inserted\n'))
})

test('choosing nothing gives an empty patch', () => {
  assert.equal(buildPatch(parseDiff(DIFF)!, [[], []]), '')
})

test('a hunk that is left out disappears, and later hunks move accordingly', () => {
  const patch = buildPatch(parseDiff(DIFF)!, [[], [1]])
  assert.ok(!patch.includes('TWO'))
  // The first hunk is not applied, so the second one starts where it did in the old file.
  assert.match(patch, /@@ -20,3 \+20,4 @@ later/)
})

test('an added line that is not chosen is left out; a removed one that is not chosen stays as context', () => {
  const d = parseDiff(DIFF)!
  // Choose the removal of "two" but not the addition of "TWO".
  const onlyRemoval = buildPatch(d, [[1], []])
  assert.match(onlyRemoval, /@@ -1,5 \+1,4 @@/)
  assert.ok(onlyRemoval.includes('-two\n'))
  assert.ok(!onlyRemoval.includes('+TWO'))
  // Choose the addition but not the removal: "two" stays, "TWO" is added after it.
  const onlyAddition = buildPatch(d, [[2], []])
  assert.match(onlyAddition, /@@ -1,5 \+1,6 @@/)
  assert.ok(onlyAddition.includes(' two\n+TWO\n'))
})

test('a later hunk starts at the right line after an earlier one changed the length', () => {
  const longer = [
    'diff --git a/f b/f',
    '--- a/f',
    '+++ b/f',
    '@@ -1,2 +1,4 @@',
    ' a',
    '+b',
    '+c',
    ' d',
    '@@ -30,2 +32,3 @@',
    ' x',
    '+y',
    ' z',
    ''
  ].join('\n')
  const patch = buildPatch(parseDiff(longer)!, [[1, 2], [1]])
  assert.match(patch, /@@ -30,2 \+32,3 @@/)
})

test('a hunk at the end of a file without a newline can only be taken whole', () => {
  const noEol = ['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+c', '\\ No newline at end of file', ''].join('\n')
  const d = parseDiff(noEol)!
  assert.throws(() => buildPatch(d, [[1]]), /whole/)
  assert.ok(buildPatch(d, [[1, 2]]).includes('\\ No newline at end of file'))
})
