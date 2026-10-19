// @ts-check
// Language breadth: a user-defined server (settings.json "languageServers") gives a made-up language diagnostics and
// completion; the bundled YAML and Dockerfile servers report syntax errors; a wrong list entry is explained; a server that is
// not installed (Go's gopls) is mentioned once in the Output, calmly, and does not stop anything else.
const path = require('node:path')
const { run } = require('../harness.cjs')

const fake = path.join(__dirname, '..', 'fake-lsp.cjs')

run(
  'languages',
  {
    'sample.fake': 'hello\nFIXME later\nworld\n',
    'bad.yaml': 'name: demo\nitems: [one, two\nother: 1\n',
    'Dockerfile': 'FROM\nRUN echo hi\n',
    'main.go': 'package main\n',
    'second.go': 'package main\n'
  },
  async (t) => {
    const { js, key, check, sleep, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const errors = () => js("document.querySelectorAll('#editor .squiggly-error').length")
    const open = async (/** @type {string} */ name) => {
      await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
      await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes(name), 4000)
      await sleep(400)
      await js("document.querySelector('#editor textarea').focus(); undefined")
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('sample.fake'), 5000)

    // ---- the user's own server ----
    await open('sample.fake')
    check('a user-defined server reports diagnostics for its files', !!(await waitFor(async () => (await errors()) === 1, 20000)), String(await errors()))
    key('End', ['control'])
    key(' ', ['control'])
    check('...and offers completions', !!(await waitFor(async () => (await js("document.body.textContent")).includes('fake-completion'), 8000)))
    key('Escape')

    // ---- the bundled servers ----
    await open('bad.yaml')
    check('the YAML server (shipped with Forge) reports a syntax error', !!(await waitFor(async () => (await errors()) > 0, 30000)), String(await errors()))
    await open('Dockerfile')
    check('the Dockerfile server is chosen by the file name', !!(await waitFor(async () => (await errors()) > 0, 30000)), String(await errors()))

    // ---- a server that is not installed ----
    process.env['PATH'] = ''
    await open('main.go')
    check('a missing server is explained in the Output, with how to install it', !!(await waitFor(async () => (await text('log')).includes('Go support needs gopls'), 8000)), (await text('log')).slice(-300))
    await open('second.go')
    await sleep(800)
    const mentions = ((await text('log')).match(/Go support needs gopls/g) ?? []).length
    check('...once, however many Go files are opened', mentions === 1, String(mentions))
    // (PATH is empty here, so unrelated git messages may appear; only a complaint about Go's server would be wrong.)
    const goErrors = await js("[...document.querySelectorAll('#log .err')].map(e => e.textContent).filter(t => /gopls|Go support/.test(t)).length")
    check('...and it is not an error', goErrors === 0, String(goErrors))
  },
  {
    userData: {
      'settings.json': JSON.stringify({
        languageServers: [{ id: 'fake', name: 'Fake', command: 'node', args: [fake], extensions: ['.fake'], languageId: 'fake' }]
      })
    }
  }
)
