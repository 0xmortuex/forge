// @ts-check
// Extension API v2: panels, storage, the activate event, and the permission-gated abilities (network, ai, files) -
// including what happens without the permission and when an extension is switched off.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')
const { startMockAi } = require('../mock-ai.cjs')

const example = (/** @type {string} */ name, /** @type {string} */ file) => fs.readFileSync(path.join(__dirname, '..', '..', 'examples', 'extensions', name, file), 'utf8')

// A probe extension: one command that runs `body` and reports its result in a status bar item.
const probe = (/** @type {string} */ id, /** @type {string[]} */ permissions, /** @type {string} */ body) => ({
  [`extensions/${id}/extension.json`]: JSON.stringify({ name: id, version: '1.0.0', permissions }),
  [`extensions/${id}/index.js`]: `export function activate(forge) {
  const item = forge.ui.statusItem({ text: '${id}: idle' })
  forge.commands.register({ id: 'go', title: 'Probe ${id}', run: async () => {
    try { item.update('${id}: ' + await (async () => { ${body} })()) }
    catch (err) { item.update('${id}: ERROR ' + err.message) }
  } })
}
`
})

startMockAi().then((mock) =>
  run(
    'extensions-v2',
    { 'a.txt': 'hello files\n', 'b.txt': 'second\n' },
    async (t) => {
      const { js, key, type, check, sleep, waitFor, userData } = t
      const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
      const stripeButtons = () => js("[...document.querySelectorAll('.tw-btn')].map(b => b.dataset.win).join(',')")
      const items = () => js("[...document.querySelectorAll('.ext-item')].map(e => e.textContent).join('|')")
      const runPalette = async (/** @type {string} */ query) => {
        key('P', ['control', 'shift'])
        await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
        await sleep(400)
        await type(query)
        await sleep(600)
        key('Enter')
        await sleep(400)
      }
      const open = async (/** @type {string} */ name) => {
        await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
        await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes(name), 3000)
        await sleep(300)
      }

      key('O', ['control'])
      await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
      await open('a.txt')

      // ---- a panel from an extension ----
      check('the extension\'s panel button is on a stripe', !!(await waitFor(async () => (await stripeButtons()).includes('ext.notes-panel.notes'), 6000)), await stripeButtons())
      await runPalette('Open Notes')
      check('the command opens the panel', !!(await waitFor(() => js("!!document.getElementById('notes-box') && document.getElementById('notes-box').offsetParent !== null"), 4000)))
      check('it follows the active file', (await text('notes-heading')).includes('a.txt'), await text('notes-heading'))
      await js("document.getElementById('notes-box').focus(); undefined")
      await type('remember me')
      const store = path.join(userData, 'extension-data', 'notes-panel.json')
      check('what is typed is stored in the extension\'s own data file', !!(await waitFor(() => fs.existsSync(store) && fs.readFileSync(store, 'utf8').includes('remember me'), 4000)), fs.existsSync(store) ? fs.readFileSync(store, 'utf8') : 'no file')
      await open('b.txt')
      check('another file shows its own (empty) note', !!(await waitFor(async () => (await text('notes-heading')).includes('b.txt') && (await js("document.getElementById('notes-box').value")) === '', 4000)), await text('notes-heading'))
      await open('a.txt')
      check('coming back shows the stored note', !!(await waitFor(async () => (await js("document.getElementById('notes-box').value")) === 'remember me', 4000)), await js("document.getElementById('notes-box').value"))

      // ---- permissions ----
      await runPalette('Probe probe-none')
      check('without "network" or "files", those calls fail with a message saying what to add', !!(await waitFor(async () => /probe-none: ERROR net\.fetch needs the "network" permission/.test(await items()), 4000)), await items())
      await runPalette('Probe probe-net')
      check('with "network", a request is made by Forge and the answer comes back', !!(await waitFor(async () => /probe-net: 200 ok/.test(await items()), 6000)), await items())
      await runPalette('Probe probe-files')
      check('with "files", the project\'s files can be read and listed', !!(await waitFor(async () => /probe-files: hello files\|a\.txt,b\.txt/.test(await items()), 4000)), await items())
      await runPalette('Probe probe-escape')
      check('...but not outside the project folder', !!(await waitFor(async () => /probe-escape: ERROR .*outside the project folder/.test(await items()), 4000)), await items())

      // ---- ai ----
      await runPalette('Summarize Current File')
      check('an extension with "ai" gets an answer from the configured server', !!(await waitFor(async () => (await text('toasts')).includes('Mock answer.'), 8000)), await text('toasts'))
      const asked = mock.requests.filter((r) => r.body && !r.body.stream && (r.body.messages?.[0]?.content ?? '').includes('Summarize the code'))
      check('...with the extension\'s own prompt and the file text', asked.length === 1 && asked[0]?.body.messages[1].content.includes('hello files'), String(asked.length))

      // ---- the Settings page shows what is asked for ----
      key(',', ['control'])
      await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
      await js("document.querySelector('.snav[data-cat=\"Extensions\"]').click()")
      await sleep(500)
      const page = await text('settings')
      check('the Extensions page lists the permissions an extension asks for', page.includes('send text to your AI server') && page.includes('make web requests') && page.includes('read files in your project'), page.slice(0, 300))

      check('an unknown permission is rejected with the list of valid ones', page.includes('Unknown permission "root"') && page.includes('network, ai, files'), page.slice(-300))

      // ---- switching it off takes everything away ----
      await js("document.querySelector('.switch[data-ext=\"notes-panel\"]').click()")
      check('switching an extension off removes its panel button', !!(await waitFor(async () => !(await stripeButtons()).includes('ext.notes-panel.notes'), 4000)), await stripeButtons())
      check('...and its panel', !!(await waitFor(() => js("!document.getElementById('notes-box')"), 3000)))
      check('the other extensions keep running', (await items()).includes('probe-net'))
    },
    {
      userData: {
        'settings.json': JSON.stringify({
          aiBaseUrl: `http://127.0.0.1:${mock.port}/v1`,
          aiModel: 'mock-model',
          extensions: { 'notes-panel': true, 'ai-summary': true, 'probe-none': true, 'probe-net': true, 'probe-files': true, 'probe-escape': true }
        }),
        'extensions/notes-panel/extension.json': example('notes-panel', 'extension.json'),
        'extensions/notes-panel/index.js': example('notes-panel', 'index.js'),
        'extensions/ai-summary/extension.json': example('ai-summary', 'extension.json'),
        'extensions/ai-summary/index.js': example('ai-summary', 'index.js'),
        ...probe('probe-none', [], "await forge.net.fetch('http://127.0.0.1:1/'); return 'unexpected'"),
        ...probe(
          'probe-net',
          ['network'],
          `const r = await forge.net.fetch('http://127.0.0.1:${mock.port}/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }); return r.status + ' ' + (r.ok ? 'ok' : 'not ok') + ' ' + (r.json().choices ? 'json' : 'nojson')`
        ),
        'extensions/bad-perm/extension.json': JSON.stringify({ name: 'Bad Perm', permissions: ['root'] }),
        'extensions/bad-perm/index.js': 'export function activate() {}',
        ...probe('probe-files', ['files'], "const text = await forge.workspace.readFile('a.txt'); const list = (await forge.workspace.listFiles()).sort().join(','); return text.trim() + '|' + list"),
        ...probe('probe-escape', ['files'], "await forge.workspace.readFile('../../secret.txt'); return 'unexpected'")
      }
    }
  ).finally(() => mock.close())
)
