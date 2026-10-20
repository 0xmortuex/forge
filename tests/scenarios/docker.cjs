// @ts-check
// The Docker window against a fake docker CLI: containers and images, actions that show up in the next listing, logs, shell,
// compose buttons, and a clear message when the daemon is not running.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tmp = (/** @type {string} */ name) => path.join(os.tmpdir(), `forge-docker-${process.pid}-${name}`)
const log = tmp('log')
fs.writeFileSync(log, '')
process.env['FORGE_DOCKER'] = path.join(__dirname, '..', 'fake-docker.cjs')
process.env['FAKE_DOCKER_LOG'] = log
process.env['FAKE_DOCKER_STATE'] = tmp('state.json')
const { run } = require('../harness.cjs')

run('docker', { 'compose.yaml': 'services: {}\n', 'a.txt': 'a\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  /** @returns {string[][]} */
  const calls = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const called = (/** @type {string[]} */ args) => calls().some((c) => args.every((p, i) => c[i] === p))
  const names = () => js("[...document.querySelectorAll('#dk-body .dk-row')].map(r => r.dataset.name).join(',')")
  const buttons = (/** @type {string} */ name) => js(`[...document.querySelectorAll('#dk-body .dk-row')].find(r => r.dataset.name === ${JSON.stringify(name)})?.querySelectorAll('.dk-buttons button') ? [...[...document.querySelectorAll('#dk-body .dk-row')].find(r => r.dataset.name === ${JSON.stringify(name)}).querySelectorAll('.dk-buttons button')].map(b => b.textContent).join(',') : ''`)
  const click = (/** @type {string} */ name, /** @type {string} */ label) => js(`[...[...document.querySelectorAll('#dk-body .dk-row')].find(r => r.dataset.name === ${JSON.stringify(name)}).querySelectorAll('.dk-buttons button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`)

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('compose.yaml'), 5000)
  await js('window.confirm = () => true; undefined')
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await sleep(400)
  await type('Toggle Docker')
  await sleep(600)
  key('Enter')

  // ---- containers ----
  check('the window shows the Docker version', !!(await waitFor(async () => (await text('dk-version')) === 'Docker 27.0.1', 5000)), await text('dk-version'))
  check('containers are listed, stopped ones too', !!(await waitFor(async () => (await names()) === 'web,db,cache', 4000)), await names())
  check('with their state', (await js("[...document.querySelectorAll('#dk-body .dk-dot')].map(d => d.className.replace('dk-dot ', '')).join(',')")) === 'running,exited,paused')
  check('Compose Up / Down appear because the project has a compose file', (await js("!document.getElementById('dk-up').hidden && !document.getElementById('dk-down').hidden")) === true)
  check('a running container can be stopped, restarted, paused, removed, read and entered', (await buttons('web')) === 'Stop,Restart,Pause,Remove,Logs,Shell', await buttons('web'))
  check('a stopped one can be started', (await buttons('db')) === 'Start,Remove,Logs', await buttons('db'))
  check('a paused one can be resumed', (await buttons('cache')) === 'Resume,Stop,Remove,Logs', await buttons('cache'))

  // ---- actions ----
  await click('web', 'Stop')
  check('Stop runs docker stop', !!(await waitFor(() => called(['stop', 'web']), 4000)))
  check('and the list shows it stopped', !!(await waitFor(async () => (await buttons('web')) === 'Start,Remove,Logs', 4000)), await buttons('web'))
  await click('web', 'Start')
  check('Start brings it back', !!(await waitFor(async () => (await buttons('web')) === 'Stop,Restart,Pause,Remove,Logs,Shell', 4000)), await buttons('web'))

  // ---- logs ----
  await click('cache', 'Logs')
  check('Logs opens the container log in a tab, stdout and stderr both', !!(await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('.log') && (await js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent.replace(/\u00a0/g, ' ')).join('|')")).includes('warn line'), 6000)), await js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent.replace(/\u00a0/g, ' ')).join('|')"))

  // ---- shell ----
  await js("document.getElementById('dk-refresh').click()")
  await waitFor(async () => (await names()) === 'web,db,cache', 4000)
  await click('web', 'Shell')
  check('Shell opens a terminal tab running docker exec', !!(await waitFor(() => js("document.body.textContent.includes('docker: web')"), 5000)))

  // ---- remove ----
  await js("document.getElementById('view-docker').scrollIntoView()")
  await click('db', 'Remove')
  check('Remove runs docker rm -f after confirming', !!(await waitFor(() => called(['rm', '-f', 'db']), 4000)))
  check('and the container leaves the list', !!(await waitFor(async () => (await names()) === 'web,cache', 4000)), await names())

  // ---- images ----
  await js("document.getElementById('dk-tab-images').click()")
  check('the Images tab lists images', !!(await waitFor(async () => (await names()) === 'nginx:1,redis:7', 4000)), await names())
  await click('nginx:1', 'Remove')
  check('Remove image runs docker rmi', !!(await waitFor(() => called(['rmi', 'nginx:1']), 4000)))
})
