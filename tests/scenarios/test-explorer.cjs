// @ts-check
// The Test Explorer with node:test: run everything, read a failure, jump to the test, fix it, and re-run only what failed.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

const TESTS = (/** @type {number} */ right) => `const test = require('node:test')
const assert = require('node:assert')
test.describe('addition', () => {
  test('adds numbers', () => assert.strictEqual(1 + 1, 2))
  test('fails on purpose', () => assert.strictEqual(1 + 1, ${right}))
  test.it('skipped one', { skip: 'not now' }, () => {})
})
test('top level passes', () => {})
`

run('test-explorer', { 'package.json': JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }), 'math.test.js': TESTS(3) }, async (t) => {
  const { js, key, type, check, sleep, waitFor, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const runPalette = async (/** @type {string} */ query) => {
    key('P', ['control', 'shift'])
    await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
    await sleep(400)
    await type(query)
    await sleep(600)
    key('Enter')
    await sleep(400)
  }

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('math.test.js'), 5000)
  await runPalette('Toggle Test Explorer')
  check('the Test Explorer opens and finds node:test', !!(await waitFor(async () => (await js("document.getElementById('tests-framework').options.length")) === 1 && (await js("document.getElementById('tests-framework').value")) === 'node', 8000)))

  // ---- run everything ----
  await js("document.getElementById('tests-run').click()")
  check('Run All shows the totals', !!(await waitFor(async () => (await text('tests-summary')).startsWith('2 passed, 1 failed, 1 skipped'), 60000)), await text('tests-summary'))
  const tree = await text('tests-tree')
  check('the tests are grouped by file and suite', tree.includes('math.test.js') && tree.includes('addition') && tree.includes('adds numbers') && tree.includes('top level passes'), tree)
  check('each shows its result', (await js("document.querySelectorAll('#tests-tree .tests-test.passed').length")) === 2 && (await js("document.querySelectorAll('#tests-tree .tests-test.failed').length")) === 1 && (await js("document.querySelectorAll('#tests-tree .tests-test.skipped').length")) === 1)
  check('the failing file and suite are marked failed', (await js("document.querySelectorAll('#tests-tree .tests-folder.failed').length")) === 2)

  // ---- read a failure ----
  await js("document.querySelector('#tests-tree .tests-test.failed').click()")
  check('picking a failed test explains why', !!(await waitFor(async () => (await text('tests-detail')).includes('2 !== 3'), 3000)), await text('tests-detail'))
  check('...with its place in the file', (await text('tests-detail')).includes('math.test.js:5'), await text('tests-detail'))
  await js("document.querySelector('#tests-tree .tests-test.failed').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
  check('double-clicking it opens the file at the test', !!(await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('math.test.js') && (await text('st-pos')).startsWith('5:'), 6000)), `${await js("document.querySelector('.tab.active')?.textContent ?? ''")} ${await text('st-pos')}`)

  // ---- fix it, re-run only the failed test ----
  fs.writeFileSync(path.join(root, 'math.test.js'), TESTS(2))
  await sleep(1500) // the editor reloads the changed file
  check('Run Failed is available', !(await js("document.getElementById('tests-failed').disabled")))
  await js("document.getElementById('tests-failed').click()")
  check('re-running the failed test updates only it', !!(await waitFor(async () => (await text('tests-summary')).startsWith('3 passed, 1 skipped'), 60000)), await text('tests-summary'))
  check('...and nothing is failed any more', (await js("document.querySelectorAll('#tests-tree .tests-test.failed').length")) === 0 && (await js("document.getElementById('tests-failed').disabled")) === true)

  // ---- run the file in the editor ----
  await js("document.getElementById('tests-file').click()")
  check('Run File runs the file in the editor', !!(await waitFor(async () => (await text('tests-summary')).startsWith('3 passed, 1 skipped') && !(await text('tests-summary')).includes('Running'), 60000)), await text('tests-summary'))
})
