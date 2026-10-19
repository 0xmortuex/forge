// @ts-check
// Renaming or moving a file in the tree updates the imports that point at it (through the language server).
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'rename-file',
  {
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' } }),
    'a.ts': 'export const a = 1\n',
    'main.ts': "import { a } from './a'\nconsole.log(a)\n",
    'sub/keep.txt': 'k\n'
  },
  async (t) => {
    const { js, key, type, enter, check, sleep, waitFor, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const node = (/** @type {string} */ name) => `[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)})`
    const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('|')")

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('main.ts'), 5000)
    await js(`${node('main.ts')}.click()`)
    await waitFor(async () => (await text('tabs')).includes('main.ts'), 3000)
    // The TypeScript server has to be up and know the project before it can answer.
    await sleep(7000)

    // ---- rename ----
    await js(`${node('a.ts')}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }))`)
    await sleep(250)
    await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.startsWith('Rename')).click()")
    await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
    await js("document.getElementById('ask-input').select(); undefined")
    await type('b.ts')
    enter()
    check('the file is renamed on disk', !!(await waitFor(() => fs.existsSync(path.join(root, 'b.ts')) && !fs.existsSync(path.join(root, 'a.ts')), 6000)))
    check('the import that pointed at it is updated in the open editor', !!(await waitFor(async () => (await editorText()).includes("from './b'"), 8000)), await editorText())
    check('...and the Output says so', (await text('log')).includes('Updated 1 reference'), (await text('log')).slice(-250))
    key('S', ['control'])
    check('saving writes the new import', !!(await waitFor(() => fs.readFileSync(path.join(root, 'main.ts'), 'utf8').includes("'./b'"), 4000)))

    // ---- move by dragging into a folder ----
    await waitFor(async () => (await js(`!!${node('b.ts')}`)) && (await js(`!!${node('sub')}`)), 4000)
    await js(`(() => { const dt = new DataTransfer(); ${node('b.ts')}.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); ${node('sub')}.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); ${node('sub')}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })) })()`)
    check('the file moves into the folder', !!(await waitFor(() => fs.existsSync(path.join(root, 'sub', 'b.ts')), 6000)))
    check('the import follows it there', !!(await waitFor(async () => (await editorText()).includes("from './sub/b'"), 8000)), await editorText())
  }
)
