// @ts-check
// The backend platform end to end: the typed RPC channel reaches the lazily activated file-index module, the module
// keeps its index current from the file watcher, state changes arrive as events, and bad requests fail loudly.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('platform-rpc', { 'src/alpha.ts': 'a\n', 'src/beta.ts': 'b\n', 'README.md': 'r\n' }, async (t) => {
  const { js, key, check, sleep, waitFor, root } = t
  const rpc = (/** @type {string} */ service, /** @type {string} */ method, /** @type {unknown[]} */ args = []) =>
    js(`window.forge.rpc(${JSON.stringify({ service, method, args })})`)
  const names = (/** @type {{ path: string }[]} */ hits) => hits.map((h) => path.relative(root, h.path).replace(/\\/g, '/'))

  // The window must have the project open so the watcher is running.
  key('O', ['control'])
  await waitFor(async () => (await js("document.getElementById('tree').textContent")).includes('README.md'), 5000)

  await js(`window.__events = []; window.forge.onRpcEvent((topic, payload) => window.__events.push([topic, payload])); undefined`)
  const opened = await rpc('fileindex', 'open', [root])
  check('open() indexes the project through the RPC channel', opened.ok && opened.value.files === 3, JSON.stringify(opened))

  const found = await rpc('fileindex', 'query', ['beta'])
  check('query() finds a file by name', found.ok && names(found.value)[0] === 'src/beta.ts', JSON.stringify(found))

  const events = await js('window.__events.filter((e) => e[0] === "fileindex.state").map((e) => e[1])')
  check('state events reach the window (indexing, then ready)', events[0] === 'indexing' && events[events.length - 1] === 'ready', JSON.stringify(events))

  fs.writeFileSync(path.join(root, 'src', 'gamma.ts'), 'g\n')
  const seen = await waitFor(async () => {
    const r = await rpc('fileindex', 'query', ['gamma'])
    return r.ok && r.value.length === 1
  }, 8000)
  check('a file created outside Forge shows up through the watcher', !!seen)

  fs.rmSync(path.join(root, 'src', 'alpha.ts'))
  const gone = await waitFor(async () => (await rpc('fileindex', 'query', ['alpha'])).value.length === 0, 8000)
  check('a deleted file leaves the index', !!gone)

  const snapshots = fs.readdirSync(path.join(t.userData, 'index'))
  check('the snapshot is stored in the user-data folder', snapshots.length === 1 && snapshots[0].endsWith('.json'), String(snapshots))

  const ghost = await rpc('nope', 'x')
  check('an unknown service is an error response', !ghost.ok && /No module provides the service "nope"/.test(ghost.error), JSON.stringify(ghost))
  const hidden = await rpc('fileindex', 'constructor')
  check('constructor is not callable', !hidden.ok, JSON.stringify(hidden))
  await sleep(50)
})
