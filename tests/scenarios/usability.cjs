// @ts-check
// Tab cycling (Ctrl+Tab / Ctrl+PageUp / Ctrl+PageDown), renaming a terminal tab, and the terminal shell setting.
const { run } = require('../harness.cjs')

run(
  'usability',
  { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' },
  async (t) => {
    const { js, key, type, enter, check, sleep, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const activeTab = () => js("document.querySelector('.tab.active')?.textContent ?? ''")

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
    for (const n of ['a.txt', 'b.txt', 'c.txt']) {
      await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(n)}).click()`)
      await waitFor(async () => (await activeTab()).includes(n), 3000)
    }

    key('Tab', ['control'])
    check('Ctrl+Tab goes to the next tab, wrapping around', !!(await waitFor(async () => (await activeTab()).includes('a.txt'), 3000)), await activeTab())
    key('Tab', ['control', 'shift'])
    check('Ctrl+Shift+Tab goes back', !!(await waitFor(async () => (await activeTab()).includes('c.txt'), 3000)), await activeTab())
    key('PageUp', ['control'])
    check('Ctrl+PageUp too', !!(await waitFor(async () => (await activeTab()).includes('b.txt'), 3000)), await activeTab())
    key('PageDown', ['control'])
    check('and Ctrl+PageDown', !!(await waitFor(async () => (await activeTab()).includes('c.txt'), 3000)), await activeTab())

    // ---- terminals ----
    key('3', ['alt'])
    await waitFor(() => js("!!document.querySelector('#term-tabs .ttab')"), 20000)
    check('the first terminal is named Local', (await text('term-tabs')).includes('Local'))
    await js("document.querySelector('#term-tabs .ttab').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
    await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
    await js("document.getElementById('ask-input').select(); undefined")
    await type('build')
    enter()
    check('double-clicking a terminal tab renames it', !!(await waitFor(async () => (await text('term-tabs')).includes('build'), 3000)), await text('term-tabs'))
    check('Ctrl+Tab still works with the terminal focused', await (async () => {
      key('Tab', ['control'])
      return !!(await waitFor(async () => (await activeTab()).includes('a.txt'), 3000))
    })())

    // The shell setting picks what new terminals run (here: cmd.exe on Windows).
    if (process.platform === 'win32') {
      key(',', ['control'])
      await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
      await js("document.querySelector('.snav[data-cat=\"Terminal\"]').click()")
      await sleep(400)
      await js(`(() => { const s = [...document.querySelectorAll('.srow')].find(r => r.querySelector('.label')?.textContent === 'Shell').querySelector('select'); s.value = 'cmd'; s.dispatchEvent(new Event('change')) })()`)
      await sleep(300)
      await js("document.getElementById('settings-close').click()")
      await js("document.getElementById('term-new').click()")
      check('a new terminal runs the chosen shell', !!(await waitFor(async () => /Microsoft Windows|>/.test(await js("document.querySelector('#term .term-pane:not([hidden]) .xterm-rows')?.textContent ?? ''")) && !(await js("document.querySelector('#term .term-pane:not([hidden]) .xterm-rows')?.textContent ?? ''")).includes('PS '), 20000)), await js("document.querySelector('#term .term-pane:not([hidden]) .xterm-rows')?.textContent ?? ''"))
    }
  }
)
