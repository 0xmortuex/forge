// @ts-check
// The Run Configurations dialog (add, edit, validate, save) and the test arrows in the gutter.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'run-config-gui',
  {
    'package.json': '{ "name": "demo" }\n',
    'math.test.js': [
      "const test = require('node:test')",
      "const assert = require('node:assert')",
      "test('adds numbers', () => { assert.strictEqual(1 + 1, 2) })",
      "test('fails on purpose', () => { assert.strictEqual(1 + 1, 3) })",
      ''
    ].join('\n'),
    'main.js': "console.log('hello')\n"
  },
  async (t) => {
    const { js, key, type, check, sleep, waitFor, root, wc } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const runText = () => js("document.querySelector('#run-term .xterm-rows')?.textContent ?? ''")
    const visible = (/** @type {string} */ id) => js(`!document.getElementById(${JSON.stringify(id)}).hidden`)
    const setField = (/** @type {number} */ nth, /** @type {string} */ value) =>
      js(`(() => { const f = document.querySelectorAll('#runcfg-form .rc-field input, #runcfg-form .rc-field textarea')[${nth}]; f.value = ${JSON.stringify(value)}; f.dispatchEvent(new Event('input')) })()`)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('main.js'), 5000)

    // ---- the dialog ----
    await js("document.getElementById('run-config').click()")
    await waitFor(() => js("[...document.querySelectorAll('#ctx .ctx-item')].some(i => i.textContent.includes('Edit Configurations'))"), 3000)
    await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.includes('Edit Configurations')).click()")
    check('Edit Configurations opens the dialog', !!(await waitFor(() => visible('runcfg'), 3000)))
    check('...listing the template\'s configurations', (await js("document.querySelectorAll('#runcfg-list .rc-item').length")) === 4, await text('runcfg-list'))

    await js("document.getElementById('runcfg-add').click()")
    check('+ adds a configuration and selects it', (await js("document.querySelectorAll('#runcfg-list .rc-item').length")) === 5 && (await js("document.querySelector('#runcfg-list .rc-item.sel .rc-name').textContent")) === 'Configuration 5')

    // Save with a node configuration that has no script: refused, with the reason shown in the dialog.
    await js("document.getElementById('runcfg-save').click()")
    check('an incomplete configuration is refused, and the dialog says why', !!(await waitFor(async () => (await text('runcfg-error')).includes('needs a "program"'), 3000)), await text('runcfg-error'))
    check('...and nothing was written', !fs.existsSync(path.join(root, '.forge', 'run.json')))

    await setField(0, 'Greeter')
    await setField(1, 'main.js')
    await setField(2, "--name 'Jane Doe' --loud")
    await js("document.getElementById('runcfg-save').click()")
    check('a valid one saves and closes the dialog', !!(await waitFor(async () => !(await visible('runcfg')), 4000)))
    const saved = fs.existsSync(path.join(root, '.forge', 'run.json')) ? JSON.parse(fs.readFileSync(path.join(root, '.forge', 'run.json'), 'utf8')) : { configurations: [] }
    const greeter = saved.configurations.find((/** @type {any} */ c) => c.name === 'Greeter')
    check('run.json has it, with the arguments split like a shell would', !!greeter && greeter.program === 'main.js' && JSON.stringify(greeter.args) === JSON.stringify(['--name', 'Jane Doe', '--loud']), JSON.stringify(greeter))

    // The new configuration can be picked and run.
    await js("document.getElementById('run-config').click()")
    await waitFor(() => js("[...document.querySelectorAll('#ctx .ctx-item')].some(i => i.textContent.includes('Greeter'))"), 3000)
    await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.includes('Greeter')).click()")
    check('it appears in the run widget', (await text('run-config-name')) === 'Greeter')
    key('F10', ['shift'])
    check('and runs', !!(await waitFor(async () => (await runText()).includes('hello'), 15000)), await runText())

    // ---- test arrows ----
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'math.test.js').click()")
    await waitFor(async () => (await text('tabs')).includes('math.test.js'), 3000)
    check('each test gets a run arrow', !!(await waitFor(async () => (await js("document.querySelectorAll('.test-run-glyph').length")) === 2, 4000)))
    const clickArrow = async (/** @type {number} */ i) => {
      const at = await js(`(() => { const r = document.querySelectorAll('.test-run-glyph')[${i}].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2 + 2), y: Math.round(r.top + r.height / 2) } })()`)
      wc.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y })
      wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    }
    await clickArrow(0)
    check(
      'clicking one runs just that test',
      !!(await waitFor(async () => {
        const o = await runText()
        return o.includes('adds numbers') && o.includes('pass 1') && !o.includes('fails on purpose')
      }, 25000)),
      await runText()
    )
    key('P', ['control', 'shift'])
    await waitFor(() => visible('palette'), 3000)
    await type('run tests in this file')
    await sleep(300)
    key('Enter')
    check(
      '"Run Tests in This File" runs them all, failures included',
      !!(await waitFor(async () => {
        const o = await runText()
        return o.includes('Process finished with exit code 1') // the failing test makes the whole run fail
      }, 25000)),
      await runText()
    )
  }
)
