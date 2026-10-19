// @ts-check
// The npm window: scripts run in a terminal tab, dependencies show their installed version, the package manager follows the
// lockfile, a monorepo package can be picked, and the update check (against a local mock registry) marks what is outdated.
const http = require('node:http')
const { run } = require('../harness.cjs')

const packument = (/** @type {string} */ name, /** @type {string} */ latest) => ({
  name,
  'dist-tags': { latest },
  versions: Object.fromEntries(['1.3.0', '2.0.0'].map((v) => [v, { name, version: v, dist: { tarball: `http://127.0.0.1/${name}-${v}.tgz` } }])),
  time: {}
})

const registry = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').slice(1))
  const known = name === 'leftpad' || name === 'tiny-dev'
  res.writeHead(known ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(known ? packument(name, '2.0.0') : { error: 'not found' }))
})

registry.listen(0, '127.0.0.1', () => {
  const port = /** @type {import('node:net').AddressInfo} */ (registry.address()).port
  process.env['npm_config_registry'] = `http://127.0.0.1:${port}/`
  run(
    'npm',
    {
      'package.json': JSON.stringify(
        {
          name: 'demo-app',
          version: '1.2.3',
          scripts: { hello: "node -e \"console.log('HELLO-' + 'FROM-SCRIPT')\"", build: 'echo build' },
          dependencies: { leftpad: '^1.3.0' },
          devDependencies: { 'tiny-dev': '~1.3.0' },
          peerDependencies: { 'peer-thing': '>=1' }
        },
        null,
        2
      ),
      'package-lock.json': '{}',
      'node_modules/leftpad/package.json': JSON.stringify({ name: 'leftpad', version: '1.3.0' }),
      'node_modules/tiny-dev/package.json': JSON.stringify({ name: 'tiny-dev', version: '1.3.0' }),
      'packages/lib/package.json': JSON.stringify({ name: '@demo/lib', version: '0.0.1', scripts: { test: 'echo lib-test' } }),
      'packages/lib/pnpm-lock.yaml': 'lockfileVersion: 9\n'
    },
    async (t) => {
      const { js, key, type, check, sleep, waitFor } = t
      const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
      const runPalette = async (/** @type {string} */ query) => {
        key('P', ['control', 'shift'])
        await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
        await sleep(400)
        await type(query)
        await sleep(600)
        key('Enter')
        await sleep(400)
      }

      key('O', ['control'])
      await waitFor(async () => (await text('tree')).includes('package.json'), 5000)
      await runPalette('Toggle npm Window')
      check('the npm window opens and finds both packages', !!(await waitFor(async () => (await js("document.querySelectorAll('#npm-pkg option').length")) === 2, 8000)), await text('npm-status'))
      check('the package manager comes from the lockfile', (await text('npm-manager')) === 'npm', await text('npm-manager'))
      const body = await text('npm-body')
      check('scripts are listed with their commands', body.includes('hello') && body.includes('build') && body.includes('echo build'), body)
      check('a dependency shows its installed version', /leftpad\s*\^1\.3\.0\s*1\.3\.0/.test(body), body)
      check('one that is not installed says so', /peer-thing\s*>=1\s*not installed/.test(body), body)

      // ---- run a script ----
      await js("document.querySelector('#npm-body .npm-script[data-script=\"hello\"] .npm-run').click()")
      check('running a script opens a terminal tab named for it', !!(await waitFor(async () => (await text('term-tabs')).includes('npm: hello'), 20000)), await text('term-tabs'))
      check('...and the script runs', !!(await waitFor(async () => (await js("document.querySelector('.term-pane:not([hidden]) .xterm-rows')?.textContent ?? ''")).includes('HELLO-FROM-SCRIPT'), 45000)), await js("document.querySelector('.term-pane:not([hidden]) .xterm-rows')?.textContent ?? ''"))

      // ---- the update check ----
      await runPalette('Toggle npm Window')
      await runPalette('Toggle npm Window')
      await js("document.getElementById('npm-outdated').click()")
      check('Check for Updates marks outdated dependencies', !!(await waitFor(async () => /leftpad[\s\S]*→ 2\.0\.0/.test(await text('npm-body')), 90000)), `${await text('npm-status')} | ${(await text('npm-body')).slice(0, 300)}`)
      const upTitle = await js("document.querySelector('#npm-body .npm-dep[data-dep=\"leftpad\"] .npm-update')?.title ?? ''")
      check('the update button shows the exact command (npm, a runtime dependency)', upTitle.endsWith('npm install leftpad@latest'), upTitle)
      const devTitle = await js("document.querySelector('#npm-body .npm-dep[data-dep=\"tiny-dev\"] .npm-update')?.title ?? ''")
      check('a dev dependency is updated with -D', devTitle.endsWith('npm install tiny-dev@latest -D'), devTitle)
      const rmTitle = await js("document.querySelector('#npm-body .npm-dep[data-dep=\"leftpad\"] .npm-remove')?.title ?? ''")
      check('the remove button shows its command', rmTitle.endsWith('npm uninstall leftpad'), rmTitle)

      // ---- another package, another manager ----
      await js("(() => { const s = document.getElementById('npm-pkg'); s.value = '1'; s.dispatchEvent(new Event('change')) })()")
      check('picking the monorepo package switches to its own manager (pnpm)', !!(await waitFor(async () => (await text('npm-manager')) === 'pnpm', 4000)), await text('npm-manager'))
      const pnpmRun = await js("document.querySelector('#npm-body .npm-script[data-script=\"test\"] .npm-run')?.title ?? ''")
      check('its scripts run with pnpm', pnpmRun === 'pnpm run test', pnpmRun)
    }
  ).finally(() => registry.close())
})
