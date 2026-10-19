// @ts-check
// Extensions: off by default, enabled ones run, a broken one is reported, a bad manifest is listed with its
// error, switching on/off at runtime, editor access from an extension, and the path-traversal guard.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

const example = (/** @type {string} */ f) => fs.readFileSync(path.join(__dirname, '..', '..', 'examples', 'extensions', 'word-count', f), 'utf8')

run(
  'extensions',
  { 'a.txt': 'one two three\n' },
  async (t) => {
    const { js, key, type, waitFor, check, userData, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))
    const paletteFor = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type(query)
      await sleep(300)
      return text('palette-results')
    }
    const runPalette = async (/** @type {string} */ query) => {
      await paletteFor(query)
      key('Enter')
      await sleep(300)
    }
    const settingsShown = () => js("!document.getElementById('settings').hidden")

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'a.txt').click()")
    await waitFor(async () => (await text('tabs')).includes('a.txt'), 5000)

    // ---- what runs, and what doesn't ----
    check('an enabled extension is active: its status item shows up', !!(await waitFor(() => js("!!document.querySelector('.ext-item')"), 8000)))
    check('...and counts the words of the open file', !!(await waitFor(async () => (await text('status')).includes('Words: 3'), 5000)), await text('status'))
    const found = await paletteFor('word count')
    check('its commands are in the palette under its name', found.includes('Word Count') && found.includes('Show Word Count'), found)
    key('Escape')
    check('an extension that was never enabled does not run', !(await paletteFor('quiet command')).includes('Quiet Command'))
    key('Escape')
    check(
      'a broken extension is reported by name, with its error',
      !!(await waitFor(async () => (await text('log')).includes('Extension "Broken"') && (await text('log')).includes('kaboom'), 5000)),
      (await text('log')).slice(-300)
    )
    check('...as an error toast too', await js("[...document.querySelectorAll('.toast.err')].some(t => t.textContent.includes('Broken'))"))

    // ---- the Extensions page ----
    key(',', ['control'])
    if (!(await waitFor(settingsShown, 3000))) throw new Error('Settings did not open')
    await js('document.querySelector(\'.snav[data-cat="Extensions"]\').click()')
    await sleep(400)
    const page = await text('settings-body')
    check('the page warns about trusting extensions', page.includes('Only turn on extensions you trust'), page.slice(0, 160))
    check('it lists all four extensions', ['Word Count', 'Broken', 'Quiet', 'badmanifest'].every((n) => page.includes(n)), page.slice(0, 400))
    check('statuses are honest: Active, Problem (broken), Off, Problem (bad manifest)', page.includes('Active') && page.includes('Problem: kaboom') && page.includes('Off') && page.includes('extension.json'), page.slice(0, 500))
    check('a bad manifest cannot be switched on', await js("document.querySelector('.switch[data-ext=\"badmanifest\"]').disabled"))
    await t.shot('extensions-page.png')

    // ---- editor access from an extension ----
    await js("document.getElementById('settings-close').click()")
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('A', ['control'])
    await runPalette('uppercase selection')
    check(
      'an extension can edit the selection',
      !!(await waitFor(async () => (await js("document.querySelector('#editor .view-lines').textContent")).replace(/ /g, ' ').includes('ONE TWO THREE'), 4000))
    )
    await runPalette('show word count')
    check('an extension can show a toast (3 words in the selection)', !!(await waitFor(() => js("[...document.querySelectorAll('.toast.ok')].some(t => t.textContent.includes('3 words'))"), 3000)))

    // ---- switching at runtime ----
    key(',', ['control'])
    await waitFor(settingsShown, 3000)
    await js('document.querySelector(\'.snav[data-cat="Extensions"]\').click()')
    await sleep(300)
    await js("document.querySelector('.switch[data-ext=\"quiet\"]').click()")
    await js("document.getElementById('settings-close').click()")
    check('...and its command appears', (await paletteFor('quiet command')).includes('Quiet Command'))
    key('Escape')
    check('the choice is saved', !!(await waitFor(() => saved().extensions?.quiet === true, 3000)), JSON.stringify(saved()))

    key(',', ['control'])
    await waitFor(settingsShown, 3000)
    await js('document.querySelector(\'.snav[data-cat="Extensions"]\').click()')
    await sleep(300)
    await js("document.querySelector('.switch[data-ext=\"word-count\"]').click()")
    await sleep(400)
    await js("document.getElementById('settings-close').click()")
    check('switching one off removes its status item', await js("!document.querySelector('.ext-item')"))
    check('...and its commands', !(await paletteFor('show word count')).includes('Show Word Count'))
    key('Escape')
    check('...and saves that', !!(await waitFor(() => saved().extensions?.['word-count'] === false, 3000)))

    // ---- the protocol only serves an extension's own files ----
    // (fetch() is blocked outright by the page's content-security policy, so probe with import(), which is allowed.)
    // extensions/secret.js sits next to the extension folders, not inside one, and sets window.__leaked if it ever runs.
    const probe = await js(`(async () => {
      const tryImport = async (url) => {
        try {
          const m = await import(/* @vite-ignore */ url)
          return { ok: true, keys: Object.keys(m) }
        } catch (e) {
          return { ok: false }
        }
      }
      return {
        own: await tryImport('forge-ext://word-count/index.js'),
        up: await tryImport('forge-ext://word-count/..%2fsecret.js'),
        leaked: window.__leaked === true
      }
    })()`)
    check('the extension protocol serves an extension its own files', probe.own.ok && probe.own.keys.includes('activate'), JSON.stringify(probe))
    check('...but not a file outside its folder (..%2f)', !probe.up.ok && !probe.leaked, JSON.stringify(probe))
  },
  {
    userData: {
      'settings.json': JSON.stringify({ extensions: { 'word-count': true, broken: true } }),
      'extensions/word-count/extension.json': example('extension.json'),
      'extensions/word-count/index.js': example('index.js'),
      'extensions/broken/extension.json': JSON.stringify({ name: 'Broken', version: '0.1.0' }),
      'extensions/broken/index.js': "export function activate(forge) {\n  forge.commands.register({ id: 'half', title: 'Half Done', run() {} })\n  throw new Error('kaboom')\n}\n",
      'extensions/quiet/extension.json': JSON.stringify({ name: 'Quiet', version: '1.0.0', description: 'Does nothing until switched on.' }),
      'extensions/quiet/index.js': "export function activate(forge) {\n  forge.commands.register({ id: 'hi', title: 'Quiet Command', run: () => forge.ui.toast('hi', 'ok') })\n}\n",
      'extensions/badmanifest/extension.json': '{ not json',
      'extensions/secret.js': 'window.__leaked = true\nexport const leaked = true\n'
    }
  }
)
