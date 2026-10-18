// @ts-check
// The remembered project folder no longer exists: say so, forget it, and stay fully usable.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'session-missing',
  { 'a.txt': 'aaa\n' },
  async (t) => {
    const { js, key, waitFor, check, userData, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const state = () => JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'))

    check('the missing folder is reported', !!(await waitFor(async () => (await text('log')).includes('Open folder'), 8000)), await text('log'))
    check('as an error toast', !!(await waitFor(() => js("!!document.querySelector('.toast.err')"), 3000)))
    check('the app is still usable (welcome screen, no project)', (await text('project-name')) === 'No project')
    check(
      'the vanished folder is forgotten',
      !!(await waitFor(() => {
        try {
          const s = state()
          return !JSON.stringify(s).includes('does-not-exist-anymore')
        } catch {
          return false // not written yet
        }
      }, 4000))
    )

    key('O', ['control'])
    check('opening a folder by hand still works', !!(await waitFor(async () => (await text('project-name')) === path.basename(root), 8000)))
  },
  { userData: { 'state.json': '{ "lastFolder": "C:\\\\does-not-exist-anymore", "recents": ["C:\\\\does-not-exist-anymore"] }' } }
)
