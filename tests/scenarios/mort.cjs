// @ts-check
// Mort: syntax highlighting + Mort's own language server (`mortc lsp`): diagnostics, hover, completion.
// Needs a Mort checkout or install: set MORTC to its mortc.py, or have `mortc` on PATH. Skips otherwise.
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')

const CHECKOUT = 'C:/Claude code free/Mort/mortc.py'
if (!process.env['MORTC']) {
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['mortc'], { cwd: __dirname }).status === 0
  if (fs.existsSync(CHECKOUT)) process.env['MORTC'] = CHECKOUT
  else if (!onPath) {
    console.log('OK mort: skipped — mortc not available (set MORTC or install mort-lang)')
    process.exit(0)
  }
}

const { run } = require('../harness.cjs')

run(
  'mort',
  {
    // Mort's formatter normalizes indentation to 4 spaces and strips trailing blanks.
    'sloppy.mx': 'fn main() -> int {\n        return 0;   \n}\n\n\n',
    'hello.mx': [
      'fn add(a: i32, b: i32) -> i32 {',
      '    return a + b;',
      '}',
      '',
      'fn main() -> int {',
      '    let x: int = "not a number";',
      '    return 0;',
      '}',
      ''
    ].join('\n')
  },
  async (t) => {
    const { js, key, type, enter, waitFor, check } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('hello.mx'), 5000)
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'hello.mx').click()")
    await waitFor(async () => (await text('tabs')).includes('hello.mx'), 5000)

    check('.mx files open as Mort', !!(await waitFor(async () => (await text('st-lang')) === 'mort', 3000)), await text('st-lang'))
    check(
      'keywords are highlighted differently from identifiers',
      !!(await waitFor(() =>
        js(`(() => {
          const spans = [...document.querySelectorAll('#editor .view-line span span')]
          const fn = spans.find((s) => s.textContent === 'fn')
          const add = spans.find((s) => s.textContent === 'add')
          return !!fn && !!add && fn.className !== add.className
        })()`), 5000))
    )
    check(
      "Mort's language server reports the type error",
      !!(await waitFor(async () => (await text('st-problems')).includes('✕ 1'), 40000)),
      `${await text('st-problems')} | ${await text('status-msg')}`
    )

    // Hover over `add` (line 1, col 5)
    key('Home', ['control'])
    for (let i = 0; i < 4; i++) key('Right')
    key('K', ['control'])
    key('I', ['control'])
    check(
      'hover shows the function signature',
      !!(await waitFor(async () => (await js("document.querySelector('.monaco-hover')?.textContent ?? ''")).includes('add'), 15000))
    )
    key('Escape')

    // Completion
    key('End', ['control'])
    enter()
    await type('pri')
    key(' ', ['control'])
    check(
      'completion offers print/println',
      !!(await waitFor(async () => (await js("document.querySelector('.suggest-widget.visible')?.textContent ?? ''")).includes('print'), 15000))
    )
    key('Escape')

    // Mort's own formatter, through Ctrl+Alt+L
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'sloppy.mx').click()")
    await waitFor(async () => (await text('tabs')).includes('sloppy.mx'), 5000)
    await t.sleep(1500)
    const before = (await js("document.querySelector('#editor .view-lines')?.textContent ?? ''")).split('\u00a0').join(' ')
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('L', ['control', 'alt'])
    check(
      "Ctrl+Alt+L formats Mort code with Mort's formatter",
      !!(await waitFor(async () => {
        const after = (await js("document.querySelector('#editor .view-lines')?.textContent ?? ''")).split('\u00a0').join(' ')
        return after !== before && after.includes('{    return 0;}') // exactly 4 spaces of indent now
      }, 20000)),
      before
    )
  }
)
