// @ts-check
// Language-server refactoring: Find Usages, Quick Fix (add import), Rename across files, Reformat.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'lsp-refactor',
  {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' }
    }),
    'util.ts': "export function greet(name: string): string {\n  return 'hi ' + name\n}\n",
    'app.ts': "import { greet } from './util'\nconsole.log(greet('a'))\ngreet('b')\n",
    'fix.ts': "greet('x')\n",
    'messy.ts': 'const   x  =   1;\nfunction f( a:number,b:number ){return a+b}\n',
    'plain.py': 'x   =  1\n'
  },
  async (t) => {
    const { js, key, waitFor, check, root, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const editorText = async () => (await js("document.querySelector('#editor .view-lines')?.textContent ?? ''")).split(' ').join(' ')
    const openNode = async (/** @type {string} */ name) => {
      await js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)
      await waitFor(async () => (await text('tabs')).includes(name), 5000)
      await sleep(400)
    }
    /** Cursor to line 1, then `n` columns right (tsserver wants the cursor inside the symbol). */
    const cursorAt = (/** @type {number} */ n) => {
      key('Home', ['control'])
      for (let i = 0; i < n; i++) key('Right')
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('util.ts'), 5000)

    // Find Usages: the declaration plus three uses in app.ts
    await openNode('util.ts')
    cursorAt(19) // inside "greet"
    const found = await waitFor(async () => {
      await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
      key('F7', ['alt'])
      await sleep(1500)
      return (await text('find-count')).startsWith('4 usages') && (await text('find-count'))
    }, 60000)
    check('Alt+F7 finds all four usages of greet', !!found, await text('find-count'))
    const results = await text('find-results')
    check(
      'usages are listed by file and line, relative to the project',
      results.includes('util.ts:1') && results.includes('app.ts:1') && results.includes('app.ts:2') && results.includes('app.ts:3') &&
        !results.toLowerCase().includes('users'),
      results.slice(0, 200)
    )
    await js("[...document.querySelectorAll('.hit')].find(h => h.textContent.includes('app.ts:3')).click()")
    check(
      'clicking a usage opens that file at the line',
      !!(await waitFor(async () => (await text('tabs')).includes('app.ts') && (await text('st-pos')).startsWith('3:'), 5000)),
      `${await text('tabs')} ${await text('st-pos')}`
    )

    // Quick Fix: a missing import
    await openNode('fix.ts')
    check('a missing name is flagged', !!(await waitFor(() => js("document.querySelectorAll('#editor .squiggly-error').length > 0"), 40000)))
    cursorAt(2)
    key('.', ['control'])
    const menu = await waitFor(async () => {
      const m = await js("document.querySelector('.action-widget')?.textContent ?? ''")
      return m.includes('import') && m
    }, 15000)
    check('Ctrl+. offers an "Add import" fix', !!menu, String(menu))
    key('Enter')
    check(
      'applying the fix inserts the import',
      !!(await waitFor(async () => /import \{ greet \} from ['"]\.\/util['"]/.test(await editorText()), 10000)),
      await editorText()
    )

    // Rename across files: util.ts is open, app.ts is not (it was opened above via a usage, so close it)
    await js("[...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes('app.ts')).querySelector('.close').click()")
    await js("[...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes('util.ts')).click()")
    await sleep(500)
    cursorAt(19)
    key('F2')
    check('F2 asks for the new name, prefilled', !!(await waitFor(async () => (await js("document.getElementById('ask-input').value")) === 'greet', 20000)))
    await js("(() => { const i = document.getElementById('ask-input'); i.value = 'welcome'; document.getElementById('ask-box').requestSubmit() })()")
    check('the open file is renamed in the editor', !!(await waitFor(async () => (await editorText()).includes('function welcome'), 15000)), await editorText())
    check(
      'a file that was not open is rewritten on disk',
      !!(await waitFor(() => {
        const app = fs.readFileSync(path.join(root, 'app.ts'), 'utf8')
        return app.includes("import { welcome } from './util'") && !app.includes('greet')
      }, 10000)),
      fs.readFileSync(path.join(root, 'app.ts'), 'utf8')
    )
    check(
      'the rename is reported with its counts',
      (await text('status-msg')).includes('Renamed greet → welcome'),
      await text('status-msg')
    )

    // Reformat
    await openNode('messy.ts')
    await waitFor(() => js("document.querySelectorAll('#editor .view-line').length > 0"), 5000)
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('L', ['control', 'alt'])
    check(
      'Ctrl+Alt+L reformats with the language server',
      !!(await waitFor(async () => {
        const t2 = await editorText()
        return t2.includes('const x = 1;') && t2.includes('function f(a: number, b: number)')
      }, 20000)),
      await editorText()
    )

    // A server without a formatter says so instead of doing nothing
    await openNode('plain.py')
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('L', ['control', 'alt'])
    check(
      'Python (pyright has no formatter) reports that clearly',
      !!(await waitFor(async () => (await text('status-msg')).includes("doesn't support formatting"), 30000)),
      await text('status-msg')
    )
  }
)
