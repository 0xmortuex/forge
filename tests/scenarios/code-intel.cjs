// @ts-check
// Language-server features beyond the basics: Go to Implementation / Type Definition, Call Hierarchy, Optimize Imports,
// unused-code dimming, inline hints, and Search Everywhere's symbol/class/action scopes.
// Uses the bundled TypeScript server, so the first run can take a while.
const { run } = require('../harness.cjs')

run(
  'code-intel',
  {
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' } }),
    'shapes.ts': [
      'export interface Shape { area(): number }',
      'export class Circle implements Shape { area(): number { return 1 } }',
      'export class Square implements Shape { area(): number { return 2 } }',
      ''
    ].join('\n'),
    'a.ts': 'export const a = 1\n',
    'b.ts': 'export const b = 2\n',
    'main.ts': [
      "import { b } from './b'",
      "import { a } from './a'",
      "import { Shape } from './shapes'",
      'function helper(): number { return a + b }',
      'function caller(): number { return helper() }',
      'function describe(s: Shape): number { const unused = 5; return s.area() }',
      'function add(x: number, y: number): number { return x + y }',
      'add(1, 2)',
      'caller()',
      ''
    ].join('\n')
  },
  async (t) => {
    const { js, key, type, check, sleep } = t
    const waitFor = (/** @type {() => any} */ fn, ms = 90000) => t.waitFor(fn, ms)
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const openNode = (/** @type {string} */ name) => js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)
    const activeTab = () => js("document.querySelector('.tab.active')?.textContent ?? ''")
    const pos = () => text('st-pos')
    const editorText = () => js("document.querySelector('#editor .view-lines')?.textContent ?? ''")
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type(query)
      await sleep(300)
      key('Enter')
      await sleep(300)
    }
    /** Puts the cursor on line `line` (1-based), column `col`. */
    const goto = async (/** @type {number} */ line, /** @type {number} */ col) => {
      key('Home', ['control'])
      for (let i = 1; i < line; i++) key('Down')
      key('Home')
      for (let i = 1; i < col; i++) key('Right')
      await sleep(150)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('main.ts'), 5000)

    // ---- Go to Implementation: one interface, two classes ----
    await openNode('shapes.ts')
    await waitFor(async () => (await activeTab()).includes('shapes.ts'), 5000)
    await goto(1, 20) // on "Shape"
    await runPalette('go to implementation')
    check(
      'Go to Implementation lists both implementations in the Find window',
      !!(await waitFor(async () => (await text('find-count')).includes('2 implementations of Shape'), 60000)),
      await text('find-count')
    )

    // ---- Go to Type Definition: from a parameter to its interface ----
    await openNode('main.ts')
    await waitFor(async () => (await activeTab()).includes('main.ts'), 5000)
    await goto(6, 19) // on the parameter "s"
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('B', ['control', 'shift'])
    check(
      'Go to Type Definition jumps to the type of the symbol',
      !!(await waitFor(async () => (await activeTab()).includes('shapes.ts') && (await pos()).startsWith('1:'), 60000)),
      `${await activeTab()} ${await pos()}`
    )

    // ---- Unused code is dimmed, inline hints appear ----
    await openNode('main.ts')
    await waitFor(async () => (await activeTab()).includes('main.ts'), 5000)
    check(
      'unused code is drawn faded (diagnostic tag)',
      !!(await waitFor(() => js("document.querySelectorAll('#editor .squiggly-inline-unnecessary').length > 0"), 60000))
    )
    check(
      'inline hints show parameter names',
      !!(await waitFor(async () => (await js("document.querySelector('#editor .view-lines')?.innerHTML ?? ''")).includes('x:'), 30000)),
      (await editorText()).slice(0, 300)
    )

    // ---- Call Hierarchy ----
    await goto(4, 10) // on "helper"
    key('H', ['control', 'alt'])
    check('Call Hierarchy opens its window', !!(await waitFor(async () => !(await js("document.getElementById('view-hierarchy').hidden")), 30000)))
    check(
      'it shows who calls the function',
      !!(await waitFor(async () => (await text('hierarchy-list')).includes('caller'), 30000)),
      await text('hierarchy-list')
    )
    await js("document.querySelector('#view-hierarchy .hier-flip').click()")
    check('the toggle switches to callees', !!(await waitFor(async () => (await text('view-hierarchy')).includes('Callees of helper'), 30000)), await text('view-hierarchy'))

    // ---- Optimize Imports ----
    await js("document.querySelector('.tw-btn[data-win=\"output\"]').click()")
    await openNode('main.ts')
    await goto(1, 1)
    await runPalette('optimize imports')
    check(
      'Optimize Imports sorts the imports',
      !!(await waitFor(async () => {
        const t0 = await editorText()
        return t0.indexOf("'./a'") >= 0 && t0.indexOf("'./a'") < t0.indexOf("'./b'")
      }, 30000)),
      (await editorText()).slice(0, 200)
    )

    // ---- Search Everywhere scopes ----
    key('A', ['control', 'shift'])
    check('Ctrl+Shift+A opens Search Everywhere on Actions', !!(await waitFor(() => js("!document.getElementById('search').hidden && document.querySelector('.scope-chip.on')?.dataset.scope === 'actions'"), 3000)))
    await type('optimize imp')
    await sleep(300)
    check('...and finds actions, with their shortcuts', (await text('search-results')).includes('Optimize Imports') && (await text('search-results')).includes('Ctrl'), await text('search-results'))
    key('Escape')

    key('N', ['control'])
    await waitFor(() => js("!document.getElementById('search').hidden"), 3000)
    check('Ctrl+N opens it on Classes', (await js("document.querySelector('.scope-chip.on').textContent")) === 'Classes')
    await type('Circ')
    check(
      'a class is found through the language server',
      !!(await waitFor(async () => (await text('search-results')).includes('Circle'), 60000)),
      await text('search-results')
    )
    key('Enter')
    check('choosing it opens its file at its line', !!(await waitFor(async () => (await activeTab()).includes('shapes.ts') && (await pos()).startsWith('2:'), 10000)), `${await activeTab()} ${await pos()}`)

    key('Shift')
    await sleep(100)
    key('Shift')
    await waitFor(() => js("!document.getElementById('search').hidden"), 3000)
    await type('shapes')
    await sleep(600)
    check('"All" lists files first', (await text('search-results')).startsWith('shapes.ts'), await text('search-results'))
    key('Tab')
    check('Tab moves to the next scope', (await js("document.querySelector('.scope-chip.on').dataset.scope")) === 'files')
    key('Escape')
  }
)
