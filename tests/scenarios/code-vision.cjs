// @ts-check
// "N references" labels above declarations (from the TypeScript server), the click that lists them, and the setting.
const { run } = require('../harness.cjs')

run(
  'code-vision',
  {
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' } }),
    'lib.ts': 'export function greet(name: string): string {\n  return `hi ${name}`\n}\n',
    'app.ts': "import { greet } from './lib'\nconsole.log(greet('a'))\nconsole.log(greet('b'))\n"
  },
  async (t) => {
    const { js, key, check, sleep, waitFor, wc } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const lenses = () => js("[...document.querySelectorAll('#editor .codelens-decoration')].map(e => e.textContent.trim()).filter(Boolean).join('|')")

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('lib.ts'), 5000)
    // The server has to know the project before it can count references: open the user first, then the declaration.
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'app.ts').click()")
    await sleep(6000)
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'lib.ts').click()")
    check('a "references" label appears above the function', !!(await waitFor(async () => /\d+ reference/.test(await lenses()), 20000)), await lenses())
    check('it counts the usages in the other file (2 calls + the import)', /[23] references?/.test(await lenses()), await lenses())

    // Monaco acts on a real mouse press, not a synthetic click event.
    const r = await js("(() => { const b = document.querySelector('#editor .codelens-decoration a').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } })()")
    wc.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y })
    wc.sendInputEvent({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    check('clicking it lists the usages in the Find window', !!(await waitFor(async () => (await text('view-find')).includes('app.ts'), 6000)), (await text('view-find')).slice(0, 200))

    // Turn the setting off: the label goes away.
    key(',', ['control'])
    await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
    await js("document.querySelector('.snav[data-cat=\"Editor\"]').click()")
    await sleep(500)
    await js("[...document.querySelectorAll('.srow')].find(r => r.querySelector('.label')?.textContent === 'Show usages above declarations').querySelector('.switch').click()")
    await js("document.getElementById('settings-close').click()")
    check('switching Code Vision off removes the labels', !!(await waitFor(async () => (await lenses()) === '', 6000)), await lenses())
  }
)
