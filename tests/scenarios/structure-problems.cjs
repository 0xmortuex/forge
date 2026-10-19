// @ts-check
// The Structure window (symbol tree that follows the cursor) and the Problems window (diagnostics of open files).
// Uses the bundled language servers, so the first run can take a while.
const { run } = require('../harness.cjs')

const SHAPES = [
  'export interface Shape { area(): number }',
  'export class Circle implements Shape {',
  '  constructor(private r: number) {}',
  '  area(): number { return Math.PI * this.r ** 2 }',
  "  describe(): string { return 'circle' }",
  '}',
  'export function makeCircle(r: number): Circle { return new Circle(r) }',
  'const bad: string = 42',
  ''
].join('\n')

run(
  'structure-problems',
  {
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' } }),
    'shapes.ts': SHAPES,
    'bad.py': 'def f(x: int) -> str:\n    return x\n',
    'notes.txt': 'plain text\n'
  },
  async (t) => {
    const { js, key, check, sleep } = t
    const waitFor = (/** @type {() => any} */ fn, ms = 90000) => t.waitFor(fn, ms)
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const openNode = (/** @type {string} */ name) =>
      js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)
    const symNames = () => js("[...document.querySelectorAll('#structure-list .sym .sname')].map(n => n.textContent).join(',')")
    const current = () => js("document.querySelector('#structure-list .sym.current .sname')?.textContent ?? ''")
    const pos = () => text('st-pos')
    const setFilter = (/** @type {string} */ v) =>
      js(`(() => { const i = document.querySelector('#view-structure .tool-filter'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input')) })()`)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('shapes.ts'), 5000)

    // ---- Structure ----
    key('7', ['alt'])
    check('Structure opens in the right dock', !!(await waitFor(async () => !(await js("document.getElementById('right').hidden")), 3000)))
    check('with no file open it says so', (await text('structure-list')).includes('Open a file'))

    await openNode('notes.txt')
    check(
      'a file without a language server says so',
      !!(await waitFor(async () => (await text('structure-list')).includes('No language server'), 5000)),
      await text('structure-list')
    )

    await openNode('shapes.ts')
    check(
      'a TypeScript file lists its symbols, in source order, members nested',
      !!(await waitFor(async () => (await symNames()) === 'Shape,area,Circle,constructor,r,area,describe,makeCircle,bad', 60000)),
      await symNames()
    )
    check('members are indented under their class', (await js("document.querySelectorAll('#structure-list .sym')[3].style.paddingLeft")) !== (await js("document.querySelectorAll('#structure-list .sym')[2].style.paddingLeft")))

    await js("[...document.querySelectorAll('#structure-list .sym')].find(r => r.textContent.includes('makeCircle')).click()")
    check('clicking a symbol moves the cursor to it', !!(await waitFor(async () => (await pos()).startsWith('7:'), 3000)), await pos())

    key('Home', ['control'])
    for (let i = 0; i < 4; i++) key('Down')
    for (let i = 0; i < 5; i++) key('Right') // inside `describe`, not just inside its class
    check('the symbol around the cursor is highlighted (follows the cursor)', !!(await waitFor(async () => (await current()) === 'describe', 3000)), await current())

    await setFilter('desc')
    check('the filter keeps a match and its parents', (await symNames()) === 'Circle,describe', await symNames())
    await setFilter('')
    await js("document.querySelector('#view-structure .icon-btn[title=\"Sort alphabetically\"]').click()")
    const top = await js("[...document.querySelectorAll('#structure-list .sym')].filter(r => parseInt(r.style.paddingLeft) < 10).map(r => r.querySelector('.sname').textContent).join(',')")
    check('sorting orders the top level by name', top === 'bad,Circle,makeCircle,Shape', top)
    await js("document.querySelector('#view-structure .icon-btn[title=\"Collapse all\"]').click()")
    check('collapse all hides the members', (await symNames()) === 'bad,Circle,makeCircle,Shape', await symNames())
    await js("document.querySelector('#view-structure .icon-btn[title=\"Expand all\"]').click()")
    check('expand all shows them again', (await symNames()).includes('describe'))

    // the editor's own Go to Symbol (Ctrl+Shift+O) is fed by the same server. Monaco's popup closes itself when the
    // window loses focus, and a hosted CI runner's window has no real OS focus, so this is only checked when it has.
    if (await js('document.hasFocus()')) {
      key('O', ['control', 'shift'])
      const outline = () => js("document.querySelector('.quick-input-widget:not([style*=\"display: none\"])')?.textContent ?? ''")
      check('Ctrl+Shift+O lists the symbols too', !!(await waitFor(async () => (await outline()).includes('makeCircle'), 20000)), await outline())
      key('Escape')
    } else console.log('SKIP structure-problems: Ctrl+Shift+O (the window has no OS focus)')

    // ---- Problems ----
    await openNode('bad.py')
    key('6', ['alt'])
    check('Alt+6 opens Problems at the bottom', !!(await waitFor(async () => !(await js("document.getElementById('view-problems').hidden")), 3000)))
    check(
      'it lists the errors of every open file, grouped',
      !!(await waitFor(async () => (await js("document.querySelectorAll('#problems-list .pfile').length")) === 2 && (await js("document.querySelectorAll('#problems-list .prob.error').length")) === 2, 60000)),
      await text('problems-list')
    )
    check('a TypeScript error is listed with its position', (await text('problems-list')).includes('[8:7]'), await text('problems-list'))
    check('the tab and status bar show the count', (await text('bottom-tabs')).includes('Problems2') && (await text('st-problems')).includes('✕ 2'), await text('bottom-tabs'))
    check('the stripe button carries a badge too', (await js("document.querySelector('.tw-btn[data-win=\"problems\"] .badge')?.textContent")) === '2')

    await js("document.querySelector('#problems-list .prob[data-line=\"8\"]').click()")
    check(
      'clicking a problem opens the file at that line',
      !!(await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('shapes.ts') && (await pos()).startsWith('8:'), 5000)),
      `${await js("document.querySelector('.tab.active')?.textContent")} ${await pos()}`
    )
    await js("document.querySelector('#view-problems .chip.error').click()")
    check('the Errors filter hides them (hints stay)', (await js("document.querySelectorAll('#problems-list .prob.error').length")) === 0 && (await js("document.querySelectorAll('#problems-list .prob.info').length")) === 1, await text('problems-list'))
    await js("document.querySelector('#view-problems .chip.error').click()")
    await js("document.querySelector('#problems-list .pfile').click()")
    check('clicking a file header folds its problems (bad.py comes first)', (await js("document.querySelectorAll('#problems-list .prob').length")) === 2, await text('problems-list'))
  }
)
