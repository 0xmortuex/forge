// @ts-check
// Case conversions and line tools from the command palette act on the selection.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'text-transforms',
  { 'words.txt': 'foo bar baz\n', 'lines.txt': 'b\na\nb\nc\n' },
  async (t) => {
    const { js, key, type, check, sleep, waitFor, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\u00a0/g, ' ')).filter(Boolean).join('|')")
    const runPalette = async (/** @type {string} */ query) => {
      key('A', ['control'])
      await sleep(300)
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await sleep(400)
      await type(query)
      await sleep(600)
      key('Enter')
      await sleep(300)
    }
    const open = async (/** @type {string} */ name) => {
      await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
      await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes(name), 3000)
      await waitFor(async () => (await editorText()).length > 0, 3000) // the tab shows before the text has loaded
      await js("document.querySelector('#editor textarea').focus(); undefined")
      await sleep(500)
    }
    const becomes = async (/** @type {string} */ query, /** @type {string} */ expected) => {
      await runPalette(query)
      return !!(await waitFor(async () => (await editorText()) === expected, 3000))
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('words.txt'), 5000)

    await open('words.txt')
    check('To camelCase', await becomes('To camelCase', 'fooBarBaz'), await editorText())
    check('To snake_case', await becomes('To snake_case', 'foo_bar_baz'), await editorText())
    check('To kebab-case', await becomes('To kebab-case', 'foo-bar-baz'), await editorText())
    check('To PascalCase', await becomes('To PascalCase', 'FooBarBaz'), await editorText())

    await open('lines.txt')
    check('Remove Duplicate Lines', await becomes('Remove Duplicate Lines', 'b|a|c'), await editorText())
    check('Sort Lines Descending', await becomes('Sort Lines Descending', 'c|b|a'), await editorText())
    check('Sort Lines Ascending', await becomes('Sort Lines Ascending', 'a|b|c'), await editorText())
    key('S', ['control'])
    check('the transformed text can be saved', !!(await waitFor(() => fs.readFileSync(path.join(root, 'lines.txt'), 'utf8').replace(/\r\n/g, '\n').startsWith('a\nb\nc'), 3000)))
  }
)
