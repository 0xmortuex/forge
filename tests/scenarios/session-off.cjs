// @ts-check
// With "restore session" off nothing reopens by itself, but recent projects can still be clicked.
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'session-off',
  { 'a.txt': 'aaa\n' },
  async (t) => {
    const { js, waitFor, check, root, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)

    await sleep(2500) // long enough for a restore to have happened, if it were going to
    check('nothing reopens by itself', (await text('project-name')) === 'No project' && (await text('tabs')) === '', await text('project-name'))
    check('the welcome screen is showing', await js("getComputedStyle(document.getElementById('welcome')).display !== 'none'"))
    check('recent projects are listed', (await text('recents')).includes(path.basename(root)), await text('recents'))

    await t.shot('welcome.png')
    await js("document.querySelector('#recents .recent').click()")
    check('clicking a recent project opens it', !!(await waitFor(async () => (await text('project-name')) === path.basename(root), 8000)))
    check('its files are in the tree', !!(await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)))
  },
  {
    userData: {
      'settings.json': '{ "restoreSession": false }',
      'state.json': '{ "lastFolder": "{{ROOT}}", "recents": ["{{ROOT}}"], "openFiles": ["{{ROOT}}\\\\a.txt"] }'
    }
  }
)
