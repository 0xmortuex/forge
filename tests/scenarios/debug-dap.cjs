// @ts-check
// Debugging with a generic Debug Adapter Protocol adapter chosen in a run configuration. The adapter is a fake one that
// debugs a toy language (tests/fake-dap.cjs); the same configuration is also tried over TCP.
const path = require('node:path')
const { run } = require('../harness.cjs')

const FAKE = path.join(__dirname, '..', 'fake-dap.cjs')
const config = (/** @type {string} */ name, /** @type {any} */ extra = {}) => ({
  name,
  type: 'dap',
  program: 'prog.toy',
  adapter: { command: 'node', args: [FAKE], transport: 'stdio' },
  ...extra
})

run(
  'debug-dap',
  {
    'prog.toy': 'x = 5\nprint hello\ny = 7\nlist = 1,2,3\nprint done\n',
    '.forge/run.json': JSON.stringify({
      configurations: [
        config('Toy'),
        config('Toy (TCP)', { adapter: { command: 'node', args: [FAKE, '${port}'], transport: 'tcp' } }),
        config('Missing adapter', { adapter: { command: 'no-such-adapter-xyz', args: [], transport: 'stdio' } }),
        config('Toy (run)')
      ]
    })
  },
  async (t) => {
    const { js, key, check, sleep, waitFor, root } = t
    void root
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const status = () => text('dbg-status')
    const frame = () => js("document.querySelector('#dbg-frames .frame')?.textContent ?? ''")
    const vars = () => text('dbg-vars')
    const runText = () => js("document.querySelector('#run-term .xterm-rows')?.textContent ?? ''")
    const choose = async (/** @type {string} */ name) => {
      await js("document.getElementById('run-config').click()")
      await sleep(250)
      await js(`[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.includes(${JSON.stringify(name)})).click()`)
      await sleep(250)
    }
    const waitPaused = (/** @type {number} */ line) => waitFor(async () => (await status()).startsWith('Paused') && (await frame()).includes(`prog.toy:${line}`), 20000)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('prog.toy'), 5000)
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'prog.toy').click()")
    await waitFor(async () => (await text('tabs')).includes('prog.toy'), 5000)
    await sleep(600)

    // A breakpoint on line 4, with the keyboard.
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('Home', ['control'])
    for (let i = 0; i < 3; i++) key('Down')
    await sleep(200)
    key('F8', ['control'])
    check('a breakpoint is set on line 4', !!(await waitFor(async () => (await js("document.querySelectorAll('.bp-glyph').length")) === 1, 3000)))

    // ---- over stdio ----
    await choose('Toy')
    key('F9', ['shift'])
    check('the adapter runs the program to the breakpoint', !!(await waitPaused(4)), `${await status()} / ${await frame()}`)
    check('the frame comes from the adapter', (await frame()).includes('main'), await frame())
    check('variables are shown, with a value the program computed', !!(await waitFor(async () => /x:5/.test(await vars()) && /y:7/.test(await vars()), 8000)), await vars())
    await js("document.getElementById('dbg-input').value = 'x'; undefined")
    await js("document.getElementById('dbg-input').focus(); undefined")
    key('Enter')
    check('evaluate asks the adapter', !!(await waitFor(async () => (await text('dbg-log')).includes('5'), 4000)), await text('dbg-log'))
    check('what the program printed reaches the Run tab', !!(await waitFor(async () => (await runText()).includes('hello'), 5000)), await runText())
    check('an adapter request Forge cannot do is refused, not ignored', !!(await waitFor(async () => (await runText()).includes('runInTerminal answered: no'), 5000)), await runText())

    key('F8')
    check('stepping moves to the next line', !!(await waitPaused(5)), `${await status()} / ${await frame()}`)
    check('a variable with children can be expanded', !!(await (async () => {
      await js("[...document.querySelectorAll('#dbg-vars .var')].find(r => r.textContent.startsWith('list')).click()")
      return waitFor(async () => /2:3/.test(await vars()) && /0:1/.test(await vars()), 4000)
    })()), await vars())
    key('F9')
    check('resuming runs to the end', !!(await waitFor(async () => (await status()) === 'Finished', 10000)), await status())
    await js("document.querySelector('.tw-btn[data-win=\"run\"]').click()") // a hidden terminal does not draw what it was sent
    check('the rest of the output arrives', !!(await waitFor(async () => (await runText()).includes('done'), 5000)), await runText())
    check('Run is available again', !!(await waitFor(() => js("!document.getElementById('run-btn').disabled"), 8000)))

    // ---- over TCP ----
    await choose('Toy (TCP)')
    key('F9', ['shift'])
    check('the same program debugs over a TCP adapter', !!(await waitPaused(4)), `${await status()} / ${await frame()}`)
    key('F2', ['control'])
    check('Stop ends the session', !!(await waitFor(async () => (await status()) === 'Finished', 15000)), await status())
    await waitFor(() => js("!document.getElementById('run-btn').disabled"), 10000)

    // ---- an adapter that is not installed ----
    await choose('Missing adapter')
    key('F9', ['shift'])
    check('a missing adapter says so, naming it', !!(await waitFor(async () => (await runText()).includes('no-such-adapter-xyz') && (await runText()).includes('was not found'), 10000)), await runText())
    check('and the session ends', !!(await waitFor(() => js("!document.getElementById('run-btn').disabled"), 10000)))

    // ---- a debug configuration is not run ----
    await choose('Toy (run)')
    key('F10', ['shift'])
    check('Run refuses a debug-only configuration, explaining why', !!(await waitFor(async () => (await text('log')).includes('is a debug configuration'), 5000)), (await text('log')).slice(-200))
  }
)
