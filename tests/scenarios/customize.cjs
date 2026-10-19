// @ts-check
// Bundled fonts, custom.css (startup, live on save, off switch), and following the system light/dark setting.
const { nativeTheme } = require('electron')
const { run } = require('../harness.cjs')

run(
  'customize',
  { 'a.txt': 'x\n' },
  async (t) => {
    const { js, key, type, waitFor, check, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const cssVar = (/** @type {string} */ name) => js(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`)
    const island = () => cssVar('--island')
    const toolbarHeight = () => js("getComputedStyle(document.getElementById('toolbar')).height")
    const fontLoaded = (/** @type {string} */ family) =>
      js(`[...document.fonts].some(f => f.family.replace(/["']/g, '') === ${JSON.stringify(family)} && f.status === 'loaded')`)
    const settingsShown = () => js("!document.getElementById('settings').hidden")
    const row = (/** @type {string} */ label) =>
      `[...document.querySelectorAll('.srow')].find(r => r.querySelector('.label')?.textContent === ${JSON.stringify(label)})`
    const openSettings = async () => {
      if (!(await settingsShown())) {
        key(',', ['control'])
        if (!(await waitFor(settingsShown, 3000))) throw new Error('Settings did not open')
      }
      await js('document.querySelector(\'.snav[data-cat="Appearance"]\').click()')
      await sleep(350)
    }
    const closeSettings = () => js("document.getElementById('settings-close').click()")
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type(query)
      await sleep(300)
      key('Enter')
      await sleep(300)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)

    // ---- bundled fonts ----
    check('the bundled JetBrains Mono is loaded', !!(await waitFor(() => fontLoaded('JetBrains Mono'), 8000)))
    check('the bundled Fira Code is loaded (so the ligatures option works on any machine)', !!(await waitFor(() => fontLoaded('Fira Code'), 8000)))
    check('a bundled interface font can be chosen (Inter Variable)', !!(await waitFor(() => fontLoaded('Inter Variable'), 8000)) && (await js('getComputedStyle(document.body).fontFamily')).includes('Inter Variable'))

    // ---- custom.css ----
    check('custom.css is applied at startup', (await toolbarHeight()) === '55px', await toolbarHeight())
    await runPalette('open custom.css')
    check('the Command Palette opens custom.css in the editor', !!(await waitFor(async () => (await text('tabs')).includes('custom.css'), 5000)))
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('A', ['control'])
    await type('#toolbar { height: 60px; }')
    key('S', ['control'])
    check('saving custom.css restyles the app live', !!(await waitFor(async () => (await toolbarHeight()) === '60px', 4000)), await toolbarHeight())
    await openSettings()
    await js(`${row('Apply custom.css')}.querySelector('.switch').click()`)
    check('"Apply custom.css" off removes the custom styles', !!(await waitFor(async () => (await toolbarHeight()) === '40px', 3000)), await toolbarHeight())
    await js(`${row('Apply custom.css')}.querySelector('.switch').click()`)
    check('...and on brings them back', !!(await waitFor(async () => (await toolbarHeight()) === '60px', 3000)))

    // ---- follow the system ----
    nativeTheme.themeSource = 'dark'
    check('following the system: dark mode uses the dark theme (Dracula)', !!(await waitFor(async () => (await island()) === '#282a36', 4000)), await island())
    nativeTheme.themeSource = 'light'
    check('light mode switches to the light theme', !!(await waitFor(async () => (await island()) === '#ffffff', 4000)), await island())
    nativeTheme.themeSource = 'dark'
    await waitFor(async () => (await island()) === '#282a36', 4000)
    await js(`(() => { const s = ${row('Theme for dark mode')}.querySelector('select'); s.value = 'nord'; s.dispatchEvent(new Event('change')) })()`)
    check('changing the dark-mode theme applies at once', !!(await waitFor(async () => (await island()) === '#2e3440', 3000)), await island())

    await js(`[...document.querySelectorAll('.theme-card')].find(c => c.querySelector('.nm').textContent === 'Gruvbox Dark').click()`)
    check('picking a theme yourself applies it', !!(await waitFor(async () => (await island()) === '#32302f', 3000)), await island())
    check('...and turns "follow the system" off', !(await js(`${row('Follow the system light/dark setting')}.querySelector('.switch').classList.contains('on')`)))
    nativeTheme.themeSource = 'light'
    await sleep(800)
    check('so the system flipping to light no longer changes it', (await island()) === '#32302f', await island())
    nativeTheme.themeSource = 'system'
    await closeSettings()
  },
  {
    userData: {
      'custom.css': '#toolbar { height: 55px; }',
      'settings.json': JSON.stringify({ autoTheme: true, themeDark: 'dracula', themeLight: 'forge-light', uiFont: 'Inter Variable' })
    }
  }
)
