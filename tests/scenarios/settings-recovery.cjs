// @ts-check
// A hand-edited settings.json with a syntax error: Forge starts with defaults, says so, and never destroys the file.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'settings-recovery',
  { 'a.txt': 'x\n' },
  async (t) => {
    const { js, key, type, waitFor, check, userData, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const cssVar = (/** @type {string} */ name) => js(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`)
    const file = path.join(userData, 'settings.json')

    check(
      'the syntax error is reported, naming the file',
      !!(await waitFor(async () => (await text('log')).includes('settings.json is not valid JSON'), 4000)),
      await text('log')
    )
    check('it pops up as an error toast too', !!(await waitFor(() => js("!!document.querySelector('.toast.err')"), 3000)))
    check('the app still starts, with default settings', (await cssVar('--accent')) === '#26c6b0')
    check('the broken file is untouched until something is saved', fs.readFileSync(file, 'utf8') === '{ nope')

    key('P', ['control', 'shift'])
    await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
    await type('toggle minimap')
    await sleep(250)
    key('Enter')
    check(
      'saving a setting writes a valid settings.json',
      !!(await waitFor(() => {
        try {
          return JSON.parse(fs.readFileSync(file, 'utf8')).minimap === true
        } catch {
          return false // still the broken file
        }
      }, 4000))
    )
    check(
      'the user’s broken file was kept as settings.json.broken',
      fs.existsSync(`${file}.broken`) && fs.readFileSync(`${file}.broken`, 'utf8') === '{ nope'
    )
  },
  { userData: { 'settings.json': '{ nope' } }
)
