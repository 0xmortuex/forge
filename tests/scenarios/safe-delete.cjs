// @ts-check
// Safe Delete: deleting a file or folder that other files still import names the references first, and asks even when
// "confirm before delete" is off. Declining leaves everything in place.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'safe-delete',
  {
    'src/main.ts': "import { u } from './util'\nimport { l } from './lib'\nconsole.log(u, l)\n",
    'src/util.ts': 'export const u = 1\n',
    'src/lib/index.ts': 'export const l = 2\n',
    'src/lib/more.ts': 'export const m = 3\n',
    'src/lonely.ts': 'export const x = 0\n',
    'docs/README.md': 'See [the util](../src/util.ts).\n'
  },
  async (t) => {
    const { js, key, check, sleep, waitFor, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const exists = (/** @type {string} */ rel) => fs.existsSync(path.join(root, rel))
    const nodeOf = (/** @type {string} */ name) => `[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)})`
    const expand = async (/** @type {string} */ name) => {
      await js(`${nodeOf(name)}.click()`)
      await sleep(400)
    }
    // Answers every confirm() with `answer` and keeps what it was asked.
    const stubConfirm = (/** @type {boolean} */ answer) => js(`window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return ${answer} }; undefined`)
    const asked = () => js('window.__asked.join("\\n---\\n")')
    const deleteViaMenu = async (/** @type {string} */ name) => {
      await js(`${nodeOf(name)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }))`)
      await sleep(300)
      await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === 'Delete').click()")
      await sleep(1200)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('src'), 5000)
    await expand('src')
    await waitFor(async () => (await text('tree')).includes('util.ts'), 4000)

    // ---- a file that is imported ----
    await stubConfirm(false)
    await deleteViaMenu('util.ts')
    const first = await asked()
    check('deleting an imported file warns first', first.includes('"util.ts" is still used'), first)
    check('and names the importing line', first.includes('main.ts:1') && first.includes("import { u } from './util'"), first)
    check('also counts the Markdown link that points at it', first.includes('2 references in 2 files') && first.includes('README.md:1'), first)
    check('declining keeps the file', exists('src/util.ts'))

    // ---- a folder that is imported ----
    await stubConfirm(false)
    await expand('src') // collapses
    await expand('src')
    await waitFor(async () => (await text('tree')).includes('lib'), 4000)
    await deleteViaMenu('lib')
    const folder = await asked()
    check('deleting a folder counts what imports from it', folder.includes('"lib" is still used') && folder.includes('main.ts:2'), folder)
    check('and keeps it when declined', exists('src/lib/index.ts'))

    // ---- a file nothing uses: the ordinary confirmation ----
    await stubConfirm(false)
    await deleteViaMenu('lonely.ts')
    const plain = await asked()
    check('an unused file gets the ordinary confirmation', plain === 'Move "lonely.ts" to the Recycle Bin?', plain)

    // ---- agreeing deletes it ----
    await stubConfirm(true)
    await deleteViaMenu('util.ts')
    check('agreeing moves the file away', !!(await waitFor(() => !exists('src/util.ts'), 5000)))
  }
)
