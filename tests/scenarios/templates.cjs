// @ts-check
// Live templates (built in and the user's own), Surround With, and the IntelliJ keymap preset.
const { run } = require('../harness.cjs')

run(
  'templates',
  { 'a.ts': 'const x = 1\nconst y = 2\nconst z = 3\n', 'b.ts': 'export {}\n' },
  async (t) => {
    const { js, key, type, check, sleep, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const openNode = (/** @type {string} */ name) => js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)
    const lines = () => js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent.replace(/\\u00a0/g, ' ')).filter(Boolean).join('\\n')")
    const flat = (/** @type {string} */ s) => s.replace(/\n/g, ' ⏎ ')
    const tabs = () => js("document.querySelectorAll('#tabs .tab').length")
    const quickOpen = () => js("!document.getElementById('quick').hidden")
    const quickRows = () => js("[...document.querySelectorAll('#quick-results .result')].map(r => r.textContent).join('|')")
    const focusEditor = () => js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type(query)
      await sleep(300)
      key('Enter')
      await sleep(300)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)

    check('a broken snippets file is reported by name', !!(await waitFor(async () => (await text('log')).includes('snippets/python.json is not valid JSON'), 5000)), await text('log'))

    await openNode('a.ts')
    await waitFor(async () => (await js("document.querySelectorAll('#tabs .tab').length")) === 1, 5000)
    await focusEditor()

    // ---- IntelliJ keymap preset ----
    key('Home', ['control'])
    key('Down')
    key('D', ['control'])
    check('Ctrl+D duplicates the line (IntelliJ preset)', !!(await waitFor(async () => (await lines()).split('\n').filter((/** @type {string} */ l) => l.includes('const y = 2')).length === 2, 3000)), await lines())
    key('Y', ['control'])
    check('Ctrl+Y deletes it again', !!(await waitFor(async () => (await lines()).split('\n').filter((/** @type {string} */ l) => l.includes('const y = 2')).length === 1, 3000)), await lines())
    key('W', ['control'])
    await sleep(300)
    check('Ctrl+W extends the selection instead of closing the tab', (await tabs()) === 1)
    key('Escape')
    await openNode('b.ts')
    await waitFor(async () => (await tabs()) === 2, 3000)
    key('F4', ['control'])
    check('Ctrl+F4 closes the tab', !!(await waitFor(async () => (await tabs()) === 1, 3000)))

    // The preset's keys belong to the editor: with focus in another input they do nothing.
    await openNode('b.ts')
    await waitFor(async () => (await tabs()) === 2, 3000)
    await js("document.querySelector('.tab').click()")
    await waitFor(async () => (await lines()).includes('const x'), 3000)
    const before = await lines()
    key('P', ['control', 'shift']) // the palette's box has focus now
    await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
    key('Y', ['control'])
    await sleep(300)
    check('...and do nothing while another box has focus', (await lines()) === before, flat(await lines()))
    key('Escape')
    await focusEditor()

    // ---- Surround With ----
    key('Home', ['control'])
    key('Down', ['shift'])
    key('Down', ['shift']) // lines 1-2 selected
    await runPalette('surround with')
    check('Surround With lists templates for the language', !!(await waitFor(async () => (await quickRows()).includes('if (…) { … }'), 3000)), await quickRows())
    await type('while')
    await sleep(200)
    key('Enter')
    check(
      'choosing one wraps the selected lines, indented',
      !!(await waitFor(async () => {
        const l = await lines()
        return l.includes('while (condition) {') && /\n\s+const x = 1\n\s+const y = 2\n\}/.test(l)
      }, 4000)),
      flat(await lines())
    )
    key('Escape')
    key('Z', ['control'])
    key('Z', ['control'])

    // ---- Live templates ----
    key('End', ['control'])
    await type('forof')
    await sleep(800)
    key('Tab')
    check('typing a template word and pressing Tab expands it', !!(await waitFor(async () => (await lines()).includes('for (const item of items)'), 4000)), await lines())
    key('Z', ['control'])

    key('J', ['control'])
    check('Ctrl+J lists the templates for the language, including your own', !!(await waitFor(async () => (await quickOpen()) && (await quickRows()).includes('hello') && (await quickRows()).includes('forof'), 3000)), await quickRows())
    await type('hello')
    await sleep(200)
    key('Enter')
    check('inserting your own template works', !!(await waitFor(async () => (await lines()).includes("console.log('hello "), 3000)), await lines())

    // ---- Preset picker in Settings ----
    key(',', ['control'])
    await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
    await js("document.querySelector('.snav[data-cat=\"Keymap\"]').click()")
    await sleep(400)
    check('the Keymap page offers the preset, set to IntelliJ IDEA', (await js("document.getElementById('keymap-preset')?.value")) === 'intellij')
    await js("(() => { const s = document.getElementById('keymap-preset'); s.value = 'forge'; s.dispatchEvent(new Event('change')) })()")
    await sleep(400)
    check('switching back removes the preset shortcuts from the list', !(await text('settings-body')).includes('Ctrl+Shift+W'), '')
    await js("document.getElementById('settings-close').click()")
  },
  {
    userData: {
      'settings.json': JSON.stringify({ keymapPreset: 'intellij' }),
      'snippets/typescript.json': JSON.stringify({ Hello: { prefix: 'hello', body: ["console.log('hello $1')"], description: 'greet' } }),
      'snippets/python.json': '{ not json'
    }
  }
)
