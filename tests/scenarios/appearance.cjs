// @ts-check
// Appearance: themes, Settings window, persistence, accent, sliders/switches, palette (with live preview),
// toasts, custom themes, animation modes, Zen mode, colored tabs.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

const NEON = JSON.stringify({ name: 'Neon', extends: 'dracula', colors: { accent: '#00ff88' } })
const BAD = JSON.stringify({ colors: { accent: 'red' } })

run(
  'appearance',
  { 'util.ts': 'export const answer = 42\n', 'notes.md': '# notes\n' },
  async (t) => {
    const { js, key, type, waitFor, check, userData, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const cssVar = (/** @type {string} */ name) => js(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`)
    const hasClass = (/** @type {string} */ cls) => js(`document.body.classList.contains(${JSON.stringify(cls)})`)
    const saved = () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))
      } catch {
        return null // not written yet
      }
    }
    const row = (/** @type {string} */ label) =>
      `[...document.querySelectorAll('.srow')].find(r => r.querySelector('.label')?.textContent === ${JSON.stringify(label)})`
    const settingsShown = () => js("!document.getElementById('settings').hidden")
    /** Opens Settings with the real shortcut, and fails loudly if it doesn't actually appear. */
    const openSettings = async (/** @type {string} */ category = 'Appearance') => {
      if (!(await settingsShown())) {
        key(',', ['control'])
        if (!(await waitFor(settingsShown, 3000))) throw new Error('Ctrl+, did not open the Settings window')
      }
      await js(`document.querySelector('.snav[data-cat="${category}"]').click()`)
      await sleep(350)
    }
    const closeSettings = async () => {
      await js("document.getElementById('settings-close').click()")
      await waitFor(() => js("document.getElementById('settings').hidden"), 2000)
    }
    const pickTheme = async (/** @type {string} */ name) => {
      await js(`[...document.querySelectorAll('.theme-card')].find(c => c.querySelector('.nm').textContent === ${JSON.stringify(name)}).click()`)
      await sleep(250)
    }
    const accent = () => cssVar('--accent')

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('util.ts'), 5000)
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'util.ts').click()")
    await waitFor(async () => (await text('tabs')).includes('util.ts'), 5000)

    // ---- defaults ----
    check('starts with the Oceanic theme', (await accent()) === '#26c6b0', await accent())
    check('colorful mode and the aurora background are on by default', (await hasClass('colorful')) && !(await hasClass('bg-solid')) && (await js("!!document.getElementById('aurora')")))
    check(
      'a TypeScript tab gets its file-type color',
      (await js("document.querySelector('.tab.active')?.style.getPropertyValue('--tab-color') ?? ''")) === '#4fc3f7'
    )

    // ---- the Settings window ----
    await openSettings()
    check('Ctrl+, opens the Settings window, with seven categories', (await settingsShown()) && (await js("document.querySelectorAll('.snav').length")) === 7)
    const cards = await js("document.querySelectorAll('.theme-card').length")
    check('the gallery shows every built-in theme plus the custom one', cards >= 18, String(cards))
    check('the invalid theme file is reported in Settings', (await text('settings-body')).includes('bad.json'), (await text('settings-body')).slice(0, 200))
    await t.shot('settings-appearance.png')

    await pickTheme('Dracula')
    check('picking a theme re-colors the interface', (await accent()) === '#bd93f9', await accent())
    check(
      'the editor follows the theme',
      !!(await waitFor(async () => (await js("getComputedStyle(document.querySelector('.monaco-editor-background')).backgroundColor")) === 'rgb(40, 42, 54)', 3000))
    )
    check('the choice is saved to settings.json', !!(await waitFor(() => saved()?.theme === 'dracula', 3000)), JSON.stringify(saved()))

    await pickTheme('Forge Light')
    check('a light theme switches the color scheme', (await js("document.documentElement.style.colorScheme")) === 'light' && (await cssVar('--island')) === '#ffffff')
    await t.shot('theme-light.png')

    await pickTheme('Neon')
    check('a custom theme file shows up and works', (await accent()) === '#00ff88', await accent())
    await pickTheme('Material Oceanic')

    // ---- accent ----
    await js(`${row('Accent color')}.querySelector('.swatch[data-color="#ff5370"]').click()`)
    check('an accent swatch overrides the theme accent', (await accent()) === '#ff5370', await accent())
    check('the changed setting shows its reset button', await js(`${row('Accent color')}.classList.contains('changed')`))
    await js(`${row('Accent color')}.querySelector('.reset').click()`)
    check('reset returns to the theme accent', (await accent()) === '#26c6b0', await accent())

    // ---- sliders, switches, search ----
    await js(`(() => { const n = ${row('Panel corner radius')}.querySelector('input.num'); n.value = '20'; n.dispatchEvent(new Event('change')) })()`)
    check('a number setting applies live (corner radius)', (await cssVar('--radius')) === '20px', await cssVar('--radius'))
    await js(`${row('Window background')}.querySelector('select').value = 'solid'; ${row('Window background')}.querySelector('select').dispatchEvent(new Event('change'))`)
    check('a select applies live (solid background)', await hasClass('bg-solid'))
    await js(`${row('Window background')}.querySelector('.reset').click()`)
    await js(`${row('Glass panels')}.querySelector('.switch').click()`)
    check('a switch applies live (glass panels)', await hasClass('glass'))
    await js(`${row('Glass panels')}.querySelector('.switch').click()`)

    await js("(() => { const s = document.getElementById('settings-search'); s.value = 'font'; s.dispatchEvent(new Event('input')) })()")
    await sleep(200)
    const found = await text('settings-body')
    check('search finds settings across categories', found.includes('Font size') && found.includes('Interface font') && found.includes('Terminal'), found.slice(0, 200))
    await js("(() => { const s = document.getElementById('settings-search'); s.value = ''; s.dispatchEvent(new Event('input')) })()")

    await js(`${row('Animations')}.querySelector('select').value = 'off'; ${row('Animations')}.querySelector('select').dispatchEvent(new Event('change'))`)
    check('Animations: Off stops all motion', (await hasClass('no-anim')) && (await cssVar('--speed')) === '0')
    await js(`${row('Animations')}.querySelector('select').value = 'reduced'; ${row('Animations')}.querySelector('select').dispatchEvent(new Event('change'))`)
    check('Animations: Reduced removes looping effects', (await hasClass('reduced')) && !(await hasClass('no-anim')))
    await js(`${row('Animations')}.querySelector('.reset').click()`)

    await js('document.querySelector(\'.snav[data-cat="Editor"]\').click()')
    await sleep(200)
    await js(`${row('Minimap')}.querySelector('.switch').click()`)
    check('editor settings save too', !!(await waitFor(() => saved()?.minimap === true, 3000)), JSON.stringify(saved()))
    check('the minimap appears in the editor', !!(await waitFor(() => js("!!document.querySelector('.monaco-editor .minimap')"), 3000)))
    await js(`${row('Minimap')}.querySelector('.reset').click()`)
    await closeSettings()

    // ---- command palette, with live preview ----
    key('P', ['control', 'shift'])
    check('Ctrl+Shift+P opens the command palette', !!(await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)))
    await type('theme nord')
    await sleep(350)
    check('the palette finds theme commands', (await text('palette-results')).includes('Nord'))
    check('highlighting a theme previews it live', (await accent()) === '#88c0d0', await accent())
    check('...without saving it yet', saved()?.theme === undefined || saved()?.theme !== 'nord')
    await t.shot('palette.png')
    key('Escape')
    await sleep(350)
    check('Escape puts the old theme back', (await accent()) === '#26c6b0', await accent())
    key('P', ['control', 'shift'])
    await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
    await type('theme tokyo')
    await sleep(250)
    key('Enter')
    await sleep(300)
    check('Enter commits the theme and saves it', (await accent()) === '#7aa2f7' && !!(await waitFor(() => saved()?.theme === 'tokyo', 3000)), await accent())
    check('commands run from the palette (Toggle Zen Mode)', await (async () => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type('zen')
      await sleep(200)
      key('Enter')
      return !!(await waitFor(() => hasClass('zen'), 3000))
    })())
    check('Zen mode hides the side and bottom windows', await js("getComputedStyle(document.getElementById('project')).display === 'none' && getComputedStyle(document.getElementById('bottom')).display === 'none'"))
    key('Z', ['control', 'alt'])
    check('Ctrl+Alt+Z leaves Zen mode', !!(await waitFor(async () => !(await hasClass('zen')), 3000)))

    // ---- toasts ----
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'notes.md').click()")
    await waitFor(async () => (await text('tabs')).includes('notes.md'), 5000)
    key('F10', ['shift'])
    check('errors pop up as toasts', !!(await waitFor(() => js("!!document.querySelector('.toast.err')"), 5000)))
    check('the toast says what went wrong', (await text('toasts')).includes("Don't know how to run"), await text('toasts'))
    await t.shot('toast.png')
    // The startup toast about the bad theme file may still be up too; dismiss them all.
    await js("document.querySelectorAll('.toast.err').forEach((t) => t.click())")
    check('clicking a toast dismisses it', !!(await waitFor(() => js("!document.querySelector('.toast.err')"), 3000)))

    // ---- every theme, for the visual record ----
    await js("document.querySelector('.tab .close')?.click()")
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'util.ts').click()")
    check('Settings closes with its Done button', !(await settingsShown()))
    await sleep(500)
    await openSettings()
    const names = await js("[...document.querySelectorAll('.theme-card .nm')].map(n => n.textContent)")
    for (const name of names) {
      await pickTheme(name)
      await closeSettings() // so the screenshot shows the editor, not the gallery
      await sleep(750) // let the crossfade finish
      await t.shot(`theme-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`)
      await openSettings()
    }
    check('all themes apply without errors', names.length >= 18, String(names.length))
  },
  { userData: { 'themes/neon.json': NEON, 'themes/bad.json': BAD } }
)
