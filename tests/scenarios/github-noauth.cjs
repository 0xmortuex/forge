// @ts-check
// The Pull Requests window when gh is not logged in: it says so instead of showing an empty list.
const path = require('node:path')

process.env['FORGE_GH'] = path.join(__dirname, '..', 'fake-gh.cjs')
process.env['FAKE_GH_AUTH'] = '0'
const { run } = require('../harness.cjs')

run('github-noauth', { 'a.txt': 'a\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await sleep(400)
  await type('Toggle Pull Requests')
  await sleep(600)
  key('Enter')
  check('it says to log in with gh', !!(await waitFor(async () => (await text('gh-list')).includes('gh auth login'), 5000)), await text('gh-list'))
  check('and offers no New Pull Request', await js("document.getElementById('gh-new').disabled"))
})
