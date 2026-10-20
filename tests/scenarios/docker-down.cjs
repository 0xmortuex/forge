// @ts-check
// The Docker window when the daemon is not running: it says so instead of showing an empty list.
const path = require('node:path')

process.env['FORGE_DOCKER'] = path.join(__dirname, '..', 'fake-docker.cjs')
process.env['FAKE_DOCKER_DOWN'] = '1'
const { run } = require('../harness.cjs')

run('docker-down', { 'a.txt': 'a\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await sleep(400)
  await type('Toggle Docker')
  await sleep(600)
  key('Enter')
  check('it says Docker is not running', !!(await waitFor(async () => (await text('dk-body')).includes('not running'), 5000)), await text('dk-body'))
  check('and offers no Compose buttons', await js("document.getElementById('dk-up').hidden"))
})
