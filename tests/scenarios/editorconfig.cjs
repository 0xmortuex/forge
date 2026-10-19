// @ts-check
// .editorconfig: indentation when a file opens, and whitespace / final newline / line endings when it is saved.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'editorconfig',
  {
    '.editorconfig': ['root = true', '', '[*]', 'insert_final_newline = true', '', '[*.py]', 'indent_style = space', 'indent_size = 4', '', '[*.{js,ts}]', 'indent_style = tab', 'indent_size = 8', 'trim_trailing_whitespace = true', 'end_of_line = crlf', '', '[docs/**.md]', 'indent_size = 3', ''].join('\n'),
    'a.js': 'let a = 1\n',
    'b.py': 'x = 1\n',
    'c.txt': 'plain',
    'docs/d.md': '# d\n'
  },
  async (t) => {
    const { js, key, type, check, sleep, waitFor, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const open = async (/** @type {string} */ name) => {
      await js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)
      await waitFor(async () => (await text('tabs')).includes(name), 3000)
      await sleep(400)
    }
    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.js'), 5000)

    await open('a.js')
    check('a JavaScript file gets tabs, 8 wide', !!(await waitFor(async () => (await text('st-indent')) === 'Tab size 8', 3000)), await text('st-indent'))
    await open('b.py')
    check('a Python file gets 4 spaces', !!(await waitFor(async () => (await text('st-indent')) === '4 spaces', 3000)), await text('st-indent'))
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'docs').click()")
    await waitFor(async () => (await text('tree')).includes('d.md'), 3000)
    await open('d.md')
    check('a section with a folder in its pattern applies to files inside it', !!(await waitFor(async () => (await text('st-indent')).startsWith('3 '), 3000)), await text('st-indent'))

    // ---- on save ----
    await js("document.querySelector('.tab').click()") // a.js
    await waitFor(async () => (await text('st-lang')) === 'javascript', 3000)
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('End', ['control'])
    await type('let b = 2   ') // trailing spaces
    key('S', ['control'])
    await waitFor(() => fs.readFileSync(path.join(root, 'a.js'), 'utf8').includes('let b'), 4000)
    const saved = fs.readFileSync(path.join(root, 'a.js'), 'utf8')
    check('saving trims trailing whitespace', saved.includes('let b = 2\r\n') && !/[ \t]\r?\n/.test(saved), JSON.stringify(saved))
    check('...uses the configured line endings', !/[^\r]\n/.test(saved), JSON.stringify(saved))
    check('...and the editor shows the same', (await text('st-eol')) === 'CRLF', await text('st-eol'))

    await open('c.txt')
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('End', ['control'])
    await type('!')
    key('S', ['control'])
    check('insert_final_newline adds the missing newline', !!(await waitFor(() => /^plain!\r?\n$/.test(fs.readFileSync(path.join(root, 'c.txt'), 'utf8')), 4000)), JSON.stringify(fs.readFileSync(path.join(root, 'c.txt'), 'utf8')))
  }
)
