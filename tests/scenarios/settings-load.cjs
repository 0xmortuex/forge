// @ts-check
// Settings from disk: applied at startup, clamped, validated, and unknown keys survive a save.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

const SEEDED = JSON.stringify({
  theme: 'nord',
  radius: 99, // out of range: clamped to the maximum
  minimap: 'yes', // wrong type: reported and ignored
  fontSize: 18,
  futureSetting: { keep: 'me' } // unknown to this version: must survive
})

run(
  'settings-load',
  { 'a.txt': 'x\n' },
  async (t) => {
    const { js, key, type, waitFor, check, userData, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const cssVar = (/** @type {string} */ name) => js(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`)
    const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))

    check('the saved theme is applied at startup', (await cssVar('--accent')) === '#88c0d0', await cssVar('--accent'))
    check('an out-of-range number is clamped to its maximum', (await cssVar('--radius')) === '28px', await cssVar('--radius'))
    check(
      'an invalid value is reported and the default is used',
      !!(await waitFor(async () => (await text('log')).includes('"minimap" has an invalid value'), 3000)),
      await text('log')
    )
    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'a.txt').click()") // the editor draws text only with a file open
    check(
      'the saved editor font size reached the editor',
      !!(await waitFor(() => js("(() => { const el = document.querySelector('#editor .view-lines'); return !!el && getComputedStyle(el).fontSize === '18px' })()"), 3000))
    )

    // Change one setting through the palette; the file is rewritten without losing anything it doesn't know.
    key('P', ['control', 'shift'])
    await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
    await type('toggle word wrap')
    await sleep(250)
    key('Enter')
    check(
      'a change is saved',
      !!(await waitFor(() => {
        try {
          return saved().wordWrap === 'on'
        } catch {
          return false // not written yet
        }
      }, 4000))
    )
    const out = saved()
    check('settings we do not know about are kept', JSON.stringify(out.futureSetting) === '{"keep":"me"}', JSON.stringify(out))
    check('known settings keep their saved values', out.theme === 'nord' && out.fontSize === 18, JSON.stringify(out))
    check('the invalid value is dropped from the file', out.minimap === undefined, JSON.stringify(out))
  },
  { userData: { 'settings.json': SEEDED } }
)
