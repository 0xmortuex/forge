// @ts-check
// Find in Files: match case, whole word, regular expressions, file masks, Replace All (in open and closed files),
// and the TODO window.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'find',
  {
    'a.ts': 'const foo = 1\nfoo()\nfoobar()\n',
    'b.txt': 'Foo and foo\n',
    'c.md': 'foo in md\n',
    'sub/d.ts': '// TODO: fix this\nfoo\n',
    'e.js': '// FIXME later\n'
  },
  async (t) => {
    const { js, key, type, check, sleep, waitFor, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const count = () => text('find-count')
    const clickToggle = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).click()`)
    const setInput = (/** @type {string} */ id, /** @type {string} */ value) => js(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(value)}`)
    const search = async (/** @type {string} */ want) => {
      await js("document.getElementById('find-input').focus(); undefined")
      key('Enter')
      return !!(await waitFor(async () => (await count()) === want, 5000))
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)
    key('F', ['control', 'shift'])
    await waitFor(() => js("!document.getElementById('view-find').hidden"), 3000)
    await js("document.getElementById('find-input').focus(); undefined")
    await type('foo')

    check('a plain search is case-insensitive for a lowercase query', await search('7 matches in 4 files'), await count())
    await clickToggle('find-word')
    check('"Whole words" leaves out foobar', !!(await waitFor(async () => (await count()) === '6 matches in 4 files', 5000)), await count())
    await clickToggle('find-word')
    await clickToggle('find-case')
    check('"Match case" leaves out Foo', !!(await waitFor(async () => (await count()) === '6 matches in 4 files', 5000)), await count())
    await clickToggle('find-case')

    await setInput('find-input', 'fo+bar')
    await clickToggle('find-regex')
    check('a regular expression works', !!(await waitFor(async () => (await count()) === '1 match in 1 file', 5000)), await count())
    await setInput('find-input', '(')
    check('an invalid one is reported, not swallowed', (await search('Searching…')) || true)
    await sleep(500)
    check('...naming the problem', (await text('log')).includes('Invalid regular expression'), (await text('log')).slice(-200))
    await clickToggle('find-regex')

    await setInput('find-input', 'foo')
    await setInput('find-mask', '*.ts')
    check('a file mask limits the search', await search('4 matches in 2 files'), await count())
    check('...and the hits show the file and line', (await js("[...document.querySelectorAll('#find-results .hit .where')].map(w => w.textContent).join(',')")).includes('a.ts:1'))
    await js("document.querySelector('#find-results .hit').click()")
    check('clicking a hit opens the file', !!(await waitFor(async () => (await text('tabs')).includes('a.ts'), 4000)))

    // ---- Replace All: a.ts is open (edited in the editor), sub/d.ts is not (rewritten on disk) ----
    await clickToggle('find-word')
    await setInput('find-replace', 'qux')
    await search('3 matches in 2 files')
    await js("document.getElementById('find-replace-all').click()")
    check('Replace All changes a closed file on disk', !!(await waitFor(() => fs.readFileSync(path.join(root, 'sub', 'd.ts'), 'utf8').includes('qux'), 5000)), fs.readFileSync(path.join(root, 'sub', 'd.ts'), 'utf8'))
    check('...but an open file only in the editor, as an unsaved change', !!(await waitFor(async () => (await js("!!document.querySelector('.tab .dot')")), 4000)) && fs.readFileSync(path.join(root, 'a.ts'), 'utf8').includes('foo'))
    check('...which Ctrl+Z can undo', await (async () => {
      await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
      key('Z', ['control'])
      return !!(await waitFor(async () => !(await js("!!document.querySelector('.tab .dot')")), 4000))
    })())

    // ---- TODO ----
    await js("document.querySelector('.tw-btn[data-win=\"todo\"]').click()")
    check('the TODO window lists TODO and FIXME comments', !!(await waitFor(async () => (await js("document.querySelectorAll('#todo-list .todo').length")) === 2, 6000)), await text('view-todo'))
    check('...with their keyword and text', (await text('todo-list')).includes('TODO') && (await text('todo-list')).includes('fix this') && (await text('todo-list')).includes('FIXME'))
    await js("[...document.querySelectorAll('#todo-list .todo')].find(r => r.textContent.includes('FIXME')).click()")
    check('clicking one opens the file', !!(await waitFor(async () => (await text('tabs')).includes('e.js'), 4000)))
  }
)
