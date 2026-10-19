// @ts-check
// The "Visual Studio" keymap preset, with keys that are not Monaco defaults (so they prove the preset works): Ctrl+D duplicates
// the line, Ctrl+Shift+L deletes it, Ctrl+Shift+U makes the selection upper case.
const { run } = require('../harness.cjs')

run(
  'keymap-visualstudio',
  { 'f.txt': 'one\ntwo\nthree\n' },
  async (t) => {
    const { js, key, check, sleep, waitFor } = t
    const lines = () => js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\\u00a0/g, ' ')).filter(Boolean).join('|')")
    key('O', ['control'])
    await waitFor(async () => (await js("document.getElementById('tree').textContent")).includes('f.txt'), 5000)
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'f.txt').click()")
    await waitFor(async () => (await lines()) === 'one|two|three', 5000)
    await js("document.querySelector('#editor textarea').focus(); undefined")
    key('Home', ['control'])
    key('Down')
    await sleep(200)

    key('D', ['control'])
    check('Ctrl+D duplicates the line', !!(await waitFor(async () => (await lines()) === 'one|two|two|three', 3000)), await lines())
    key('L', ['control', 'shift'])
    check('Ctrl+Shift+L deletes the line', !!(await waitFor(async () => (await lines()) === 'one|two|three', 3000)), await lines())
    // Ctrl+Shift+U (upper case) is not a Monaco default either.
    key('Up')
    key('Home')
    key('End', ['shift'])
    await sleep(200)
    key('U', ['control', 'shift'])
    check('Ctrl+Shift+U makes the selection upper case', !!(await waitFor(async () => (await lines()) === 'one|TWO|three', 3000)), await lines())
  },
  { userData: { 'settings.json': JSON.stringify({ keymapPreset: 'visualstudio' }) } }
)
