// @ts-check
// Editor chrome: breadcrumbs (path + symbol chain), the Project tree toolbar, and tab handling (middle-click, reorder).
// Uses the bundled TypeScript server for the symbol part, so the first run can take a while.
const { run } = require('../harness.cjs')

const SHAPES = [
  'export class Circle {',
  '  area(): number { return 1 }',
  "  describe(): string { return 'circle' }",
  '}',
  ''
].join('\n')

run(
  'chrome',
  {
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' } }),
    'src/lib/shapes.ts': SHAPES,
    'a.txt': 'a\n',
    'b.txt': 'b\n',
    'c.txt': 'c\n'
  },
  async (t) => {
    const { js, key, type, check, sleep } = t
    const waitFor = (/** @type {() => any} */ fn, ms = 60000) => t.waitFor(fn, ms)
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const node = (/** @type {string} */ name) => `[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)})`
    const tabNames = () => js("[...document.querySelectorAll('#tabs .tab')].map(t => t.textContent.replace('●', '')).join(',')")
    const crumbs = () => js("[...document.querySelectorAll('#breadcrumbs .crumb:not(.sep)')].map(c => c.textContent).join('/')")
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type(query)
      await sleep(300)
      key('Enter')
      await sleep(300)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('src'), 5000)

    // ---- Project tree toolbar ----
    check('the tree toolbar names the project', (await text('tree-title')).length > 0, await text('tree-title'))
    await js(`${node('src')}.click()`)
    await waitFor(async () => (await text('tree')).includes('lib'), 3000)
    await js(`${node('lib')}.click()`)
    await waitFor(async () => (await text('tree')).includes('shapes.ts'), 3000)
    await js(`${node('shapes.ts')}.click()`)

    // ---- Breadcrumbs ----
    check('the breadcrumbs show the path in the project', !!(await waitFor(async () => (await crumbs()) === 'src/lib/shapes.ts', 5000)), await crumbs())
    // line 3, inside describe()
    key('Home', ['control'])
    key('Down')
    key('Down')
    for (let i = 0; i < 5; i++) key('Right')
    check(
      'and the class and method around the cursor',
      !!(await waitFor(async () => (await crumbs()) === 'src/lib/shapes.ts/Circle/describe', 60000)),
      await crumbs()
    )
    await js("[...document.querySelectorAll('#breadcrumbs .crumb.sym')].find(c => c.textContent === 'Circle').click()")
    check('clicking a symbol crumb jumps to it', !!(await waitFor(async () => (await text('st-pos')).startsWith('1:'), 3000)), await text('st-pos'))

    await runPalette('toggle breadcrumbs')
    check('Toggle Breadcrumbs hides the bar', !!(await waitFor(() => js("getComputedStyle(document.getElementById('breadcrumbs')).display === 'none'"), 3000)))
    await runPalette('toggle breadcrumbs')
    check('...and shows it again', !!(await waitFor(() => js("getComputedStyle(document.getElementById('breadcrumbs')).display !== 'none'"), 3000)))

    // ---- tree: collapse all / select the open file ----
    await js("document.querySelector('#tree-bar [title=\"Collapse all\"]').click()")
    check('Collapse all closes the folders', !!(await waitFor(() => js(`${node('src')}.nextElementSibling.hidden`), 3000)))
    await js("document.querySelector('#tree-bar [title=\"Select the open file\"]').click()")
    check(
      'Select the open file expands the tree to it',
      !!(await waitFor(() => js("document.querySelector('.node.active')?.dataset.path?.endsWith('shapes.ts') ?? false"), 3000))
    )

    // ---- tabs ----
    for (const n of ['a.txt', 'b.txt', 'c.txt']) await js(`${node(n)}.click()`)
    await waitFor(async () => (await tabNames()) === 'shapes.ts,a.txt,b.txt,c.txt', 3000)
    check('the breadcrumbs follow the active tab', (await crumbs()) === 'c.txt', await crumbs())
    await js(`(() => {
      const [, , , c] = document.querySelectorAll('#tabs .tab')
      const a = document.querySelectorAll('#tabs .tab')[1]
      const dt = new DataTransfer()
      c.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      a.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      a.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })()`)
    check('dragging a tab onto another reorders them', !!(await waitFor(async () => (await tabNames()) === 'shapes.ts,c.txt,a.txt,b.txt', 3000)), await tabNames())
    await js("[...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes('a.txt')).dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))")
    check('middle-click closes a tab', !!(await waitFor(async () => (await tabNames()) === 'shapes.ts,c.txt,b.txt', 3000)), await tabNames())

    // ---- follow the open file ----
    await runPalette('select open file in project tree')
    await js("[...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes('shapes.ts')).click()")
    check(
      'with "select the open file" on, switching tabs selects the file in the tree',
      !!(await waitFor(() => js("document.querySelector('.node.active')?.dataset.path?.endsWith('shapes.ts') ?? false"), 3000))
    )
  }
)
