// @ts-check
// A mistake in the languageServers list of settings.json is explained, naming the entry and what is wrong.
const { run } = require('../harness.cjs')

run(
  'languages-config',
  { 'a.txt': 'x\n' },
  async (t) => {
    const { key, check, waitFor, js } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
    check('a server without a command is refused with the entry and the reason', !!(await waitFor(async () => (await text('log')).includes('languageServers[1].command must be the program to run'), 8000)), (await text('log')).slice(-300))
  },
  {
    userData: {
      'settings.json': JSON.stringify({
        languageServers: [
          { id: 'ok', command: 'node', extensions: ['.ok'] },
          { id: 'broken', extensions: ['.broken'] }
        ]
      })
    }
  }
)
