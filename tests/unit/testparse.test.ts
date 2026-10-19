import assert from 'node:assert/strict'
import test from 'node:test'
import { parseJestJson, parseJunit, parseTap, totalsOf } from '../../src/main/testparse'

// Real output of `node --test --test-reporter=tap` for a file with a suite (one passing, one failing, one skipped test) and a
// top-level test. Backslashes are doubled the way TAP writes them.
const TAP = String.raw`TAP version 13
# Subtest: addition
    # Subtest: adds numbers
    ok 1 - adds numbers
      ---
      duration_ms: 0.4523
      type: 'test'
      location: 'C:\\proj\\math.test.js:4:3'
      ...
    # Subtest: fails on purpose
    not ok 2 - fails on purpose
      ---
      duration_ms: 0.6435
      type: 'test'
      location: 'C:\\proj\\math.test.js:5:3'
      failureType: 'testCodeFailure'
      error: |-
        Expected values to be strictly equal:

        2 !== 3

      code: 'ERR_ASSERTION'
      name: 'AssertionError'
      stack: |-
        TestContext.<anonymous> (C:\proj\math.test.js:5:41)
      ...
    # Subtest: skipped one
    ok 3 - skipped one # SKIP not now
      ---
      duration_ms: 0.0758
      type: 'test'
      location: 'C:\\proj\\math.test.js:6:3'
      ...
    1..3
not ok 1 - addition
  ---
  duration_ms: 1.8722
  type: 'suite'
  location: 'C:\\proj\\math.test.js:3:6'
  failureType: 'subtestsFailed'
  error: '1 subtest failed'
  code: 'ERR_TEST_FAILURE'
  ...
# Subtest: top level passes
ok 2 - top level passes
  ---
  duration_ms: 0.0807
  type: 'test'
  location: 'C:\\proj\\math.test.js:8:1'
  ...
1..2
# tests 4
`

test('TAP: only the tests are reported, not the suites around them', () => {
  const tests = parseTap(TAP)
  assert.deepEqual(
    tests.map((t) => t.name),
    ['adds numbers', 'fails on purpose', 'skipped one', 'top level passes']
  )
})

test('TAP: tests know their suite, status, file and line', () => {
  const [add, fail, skip, top] = parseTap(TAP)
  assert.deepEqual(add?.suite, ['addition'])
  assert.equal(add?.status, 'passed')
  assert.equal(add?.file, 'C:\\proj\\math.test.js')
  assert.equal(add?.line, 4)
  assert.equal(fail?.status, 'failed')
  assert.equal(fail?.line, 5)
  assert.equal(skip?.status, 'skipped')
  assert.deepEqual(top?.suite, [])
  assert.equal(top?.status, 'passed')
})

test('TAP: a failure carries its multi-line message', () => {
  const fail = parseTap(TAP)[1]
  assert.match(fail?.message ?? '', /Expected values to be strictly equal:/)
  assert.match(fail?.message ?? '', /2 !== 3/)
})

test('TAP: durations are read', () => {
  assert.equal(parseTap(TAP)[0]?.durationMs, 0.4523)
})

test('TAP: totals', () => {
  assert.deepEqual(totalsOf(parseTap(TAP)), { passed: 2, failed: 1, skipped: 1 })
})

test('TAP: nested suites list every level, outermost first', () => {
  const text = String.raw`TAP version 13
# Subtest: outer
    # Subtest: inner
        # Subtest: leaf
        ok 1 - leaf
          ---
          duration_ms: 1
          ...
        1..1
    ok 1 - inner
      ---
      duration_ms: 1
      ...
    1..1
ok 1 - outer
  ---
  duration_ms: 1
  ...
1..1
`
  const [t] = parseTap(text)
  assert.equal(t?.name, 'leaf')
  assert.deepEqual(t?.suite, ['outer', 'inner'])
})

test('Jest/Vitest JSON: assertions become tests with their ancestors', () => {
  const json = JSON.stringify({
    testResults: [
      {
        name: '/p/a.test.ts',
        assertionResults: [
          { title: 'adds', ancestorTitles: ['math'], status: 'passed', duration: 3 },
          { title: 'breaks', ancestorTitles: ['math', 'edge'], status: 'failed', duration: 1, failureMessages: ['expected 1 to be 2'] },
          { title: 'later', ancestorTitles: [], status: 'pending' }
        ]
      }
    ]
  })
  const tests = parseJestJson(json)
  assert.equal(tests.length, 3)
  assert.deepEqual(tests[1]?.suite, ['math', 'edge'])
  assert.equal(tests[1]?.message, 'expected 1 to be 2')
  assert.equal(tests[2]?.status, 'skipped')
  assert.equal(tests[0]?.file, '/p/a.test.ts')
})

test('Jest/Vitest JSON: a file that could not run is shown as a failure, not dropped', () => {
  const tests = parseJestJson(JSON.stringify({ testResults: [{ name: '/p/broken.test.ts', status: 'failed', message: 'SyntaxError: Unexpected token', assertionResults: [] }] }))
  assert.equal(tests.length, 1)
  assert.equal(tests[0]?.status, 'failed')
  assert.match(tests[0]?.message ?? '', /SyntaxError/)
})

test('JUnit XML: pytest cases, failures, skips and entities', () => {
  const xml = `<?xml version="1.0"?><testsuites><testsuite name="pytest" tests="3">
    <testcase classname="tests.test_math" name="test_add" time="0.002"/>
    <testcase classname="tests.test_math" name="test_sub" time="0.010"><failure message="assert 1 == 2&#10;where 1 = f()">trace here</failure></testcase>
    <testcase classname="tests.test_other" name="test_skip" time="0"><skipped message="not now"/></testcase>
  </testsuite></testsuites>`
  const tests = parseJunit(xml)
  assert.deepEqual(
    tests.map((t) => [t.name, t.status]),
    [['test_add', 'passed'], ['test_sub', 'failed'], ['test_skip', 'skipped']]
  )
  assert.deepEqual(tests[0]?.suite, ['tests', 'test_math'])
  assert.equal(tests[0]?.durationMs, 2)
  assert.equal(tests[1]?.message, 'assert 1 == 2\nwhere 1 = f()')
})
