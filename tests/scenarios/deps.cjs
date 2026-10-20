// @ts-check
// The Dependencies window: the import graph by folder and by file, circular imports found and drawn in red, a node's imports
// and importers listed.
const { run } = require('../harness.cjs')

run(
  'deps',
  {
    'src/app/main.ts': "import { a } from '../core/a'\nimport { log } from '../util/log'\n",
    'src/core/a.ts': "import { b } from './b'\nimport { log } from '../util/log'\nexport const a = 1\n",
    'src/core/b.ts': "import { c } from './c'\nexport const b = 1\n",
    'src/core/c.ts': "import { a } from './a'\nexport const c = 1\n",
    'src/util/log.ts': 'export const log = 1\n'
  },
  async (t) => {
    const { js, key, type, check, sleep, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const count = (/** @type {string} */ sel) => js(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
    const x = (/** @type {string} */ id) => js(`(() => { const g = [...document.querySelectorAll('#deps-svg .deps-node')].find(n => n.dataset.id === ${JSON.stringify(id)}); return g ? Number(g.getAttribute('transform').match(/translate\\(([\\d.]+)/)[1]) : -1 })()`)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('src'), 5000)
    key('P', ['control', 'shift'])
    await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
    await sleep(400)
    await type('Toggle Dependencies')
    await sleep(600)
    key('Enter')

    check('the summary counts files, imports and circles', !!(await waitFor(async () => (await text('deps-summary')) === '5 files · 6 imports · 1 circular import', 6000)), await text('deps-summary'))

    // ---- folders ----
    check('by folder there is one node per folder', !!(await waitFor(async () => (await count('#deps-svg .deps-node')) === 3, 3000)), String(await count('#deps-svg .deps-node')))
    check('and one arrow per pair (app→core, app→util, core→util)', (await count('#deps-svg .deps-edge')) === 3, String(await count('#deps-svg .deps-edge')))
    check('nothing is red between folders: the circle is inside one', (await count('#deps-svg .deps-edge.cyclic')) === 0)
    check('what depends on nothing sits furthest right', (await x('src/app')) < (await x('src/core')) && (await x('src/core')) < (await x('src/util')), `${await x('src/app')} ${await x('src/core')} ${await x('src/util')}`)

    // ---- the circle is listed ----
    const cycle = await js("document.querySelector('#deps-side .deps-cycle')?.textContent ?? ''")
    check('the circular import is listed with its files', cycle.includes('3 files import each other') && cycle.includes('src/core/a.ts') && cycle.includes('src/core/b.ts') && cycle.includes('src/core/c.ts'), cycle)

    // ---- files ----
    await js("document.getElementById('deps-mode-files').click()")
    check('by file there is one node per file', !!(await waitFor(async () => (await count('#deps-svg .deps-node')) === 5, 3000)), String(await count('#deps-svg .deps-node')))
    check('and one arrow per import', (await count('#deps-svg .deps-edge')) === 6)
    check('the three arrows of the circle are red', (await count('#deps-svg .deps-edge.cyclic')) === 3, String(await count('#deps-svg .deps-edge.cyclic')))
    check('and so are its three files', (await count('#deps-svg .deps-node.cyclic')) === 3)

    await js("[...document.querySelectorAll('#deps-svg .deps-node')].find(n => n.dataset.id === 'src/app/main.ts').dispatchEvent(new MouseEvent('click', { bubbles: true }))")
    check('selecting a file lists what it imports', !!(await waitFor(async () => (await text('deps-side')).includes('Imports (2)') && (await text('deps-side')).includes('src/core/a.ts') && (await text('deps-side')).includes('src/util/log.ts'), 3000)), (await text('deps-side')).slice(0, 200))
    await js("[...document.querySelectorAll('#deps-svg .deps-node')].find(n => n.dataset.id === 'src/util/log.ts').dispatchEvent(new MouseEvent('click', { bubbles: true }))")
    check('and what imports it', !!(await waitFor(async () => (await text('deps-side')).includes('Imported by (2)'), 3000)), (await text('deps-side')).slice(0, 200))

    await js("(() => { const f = document.getElementById('deps-filter'); f.value = 'core'; f.dispatchEvent(new Event('input')) })()")
    check('the filter narrows the files', !!(await waitFor(async () => (await count('#deps-svg .deps-node')) === 3, 3000)), String(await count('#deps-svg .deps-node')))

    // Clicking a circle in the list shows it in the file view.
    await js("(() => { const f = document.getElementById('deps-filter'); f.value = ''; f.dispatchEvent(new Event('input')) })()")
    await js("document.querySelector('#deps-side .deps-cycle').click()")
    check('clicking a circle selects its first file', !!(await waitFor(async () => (await js("document.querySelector('#deps-svg .deps-node.selected')?.dataset.id ?? ''")) === 'src/core/a.ts', 3000)), await js("document.querySelector('#deps-svg .deps-node.selected')?.dataset.id ?? ''"))
  }
)
