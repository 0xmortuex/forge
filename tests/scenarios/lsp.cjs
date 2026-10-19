// @ts-check
// Language servers: TypeScript (diagnostics, hover, completion, go-to-definition), Python, missing clangd.
// Uses the bundled servers, so the first run can take a while.
const { spawnSync } = require('node:child_process')
const { run } = require('../harness.cjs')

run(
  'lsp',
  {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' }
    }),
    'math.ts': 'export function add(a: number, b: number): number {\n  return a + b\n}\n',
    'main.ts': "import { add } from './math'\nconst r: string = add(1, 2)\nconst q = add",
    'bad.py': 'def f(x: int) -> str:\n    return x\n',
    'hello.c': 'int main(void) { return 0; }\n'
  },
  async (t) => {
    const { js, key, type, enter, check } = t
    const waitFor = (/** @type {() => any} */ fn, ms = 90000) => t.waitFor(fn, ms)
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const openNode = (/** @type {string} */ name) =>
      js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('main.ts'), 5000)

    await openNode('main.ts')
    check(
      'ts: type error shows up in the status bar',
      !!(await waitFor(async () => (await text('st-problems')).includes('✕ 1'))),
      await text('st-problems')
    )

    // Hover on `add` (line 2, col 21)
    key('Home', ['control'])
    key('Down')
    for (let i = 0; i < 20; i++) key('Right')
    key('K', ['control'])
    key('I', ['control'])
    check(
      'ts: hover shows the function signature',
      !!(await waitFor(async () => (await js("document.querySelector('.monaco-hover')?.textContent ?? ''")).includes('a: number')))
    )
    key('Escape')

    // Completion on a string
    key('End', ['control'])
    enter()
    await type('r.toUp')
    key(' ', ['control'])
    check(
      'ts: completion offers toUpperCase',
      !!(await waitFor(async () => (await js("document.querySelector('.suggest-widget.visible')?.textContent ?? ''")).includes('toUpperCase')))
    )
    key('Escape')

    // Go to definition across files
    key('Home', ['control'])
    key('Down')
    key('Down')
    key('End')
    key('F12')
    check(
      'ts: F12 opens math.ts at the definition',
      !!(await waitFor(async () => (await text('tabs')).includes('math.ts') && (await text('st-pos')).startsWith('1:')))
    )

    await openNode('bad.py')
    check(
      'py: pyright flags returning int from a -> str function',
      !!(await waitFor(async () => (await js("document.querySelectorAll('.squiggly-error').length")) > 0))
    )

    // clangd is not bundled. If it's installed it must start cleanly; if not, its absence must be reported.
    const hasClangd = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['clangd']).status === 0
    await openNode('hello.c')
    if (hasClangd) {
      await t.sleep(8000)
      check(
        'c: clangd starts without reporting errors',
        await js("document.querySelectorAll('#log .err').length === 0"),
        await js("[...document.querySelectorAll('#log .err')].map(e => e.textContent).join(' | ')")
      )
    } else {
      check(
        'c: missing clangd is reported clearly',
        !!(await waitFor(async () => (await text('log')).includes('clangd not found'), 15000))
      )
    }
  }
)
