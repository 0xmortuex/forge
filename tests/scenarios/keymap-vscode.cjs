// @ts-check
// The "Visual Studio Code" keymap preset. Only keys that are NOT already Monaco's own defaults prove the preset works, so
// this uses Ctrl+B (toggles the Project window; plain Forge has no such key) and Ctrl+Shift+H (Replace in Files).
const { run } = require('../harness.cjs')

run(
  'keymap-vscode',
  { 'f.txt': 'one\ntwo\nthree\n' },
  async (t) => {
    const { js, key, check, sleep, waitFor } = t
    key('O', ['control'])
    await waitFor(async () => (await js("document.getElementById('tree').textContent")).includes('f.txt'), 5000)
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'f.txt').click()")
    await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('f.txt'), 5000)
    await js("document.querySelector('#editor textarea').focus(); undefined")
    await sleep(300)

    check('the Project window is showing at first', !(await js("document.getElementById('project').hidden")))
    key('B', ['control'])
    check('Ctrl+B hides it (the VS Code way)', !!(await waitFor(() => js("document.getElementById('project').hidden"), 3000)))
    await js("document.querySelector('#editor textarea').focus(); undefined")
    key('B', ['control'])
    check('and shows it again', !!(await waitFor(() => js("!document.getElementById('project').hidden"), 3000)))

    await js("document.querySelector('#editor textarea').focus(); undefined")
    key('H', ['control', 'shift'])
    check('Ctrl+Shift+H opens Replace in Files', !!(await waitFor(() => js("!document.getElementById('view-find').hidden"), 3000)))

    // The Keymap page offers all four presets, with this one chosen.
    key(',', ['control'])
    await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
    await js("document.querySelector('.snav[data-cat=\"Keymap\"]').click()")
    await sleep(500)
    check('the Keymap page lists every preset, set to Visual Studio Code', (await js("[...document.querySelectorAll('#keymap-preset option')].map(o => o.value).join(',')")) === 'forge,intellij,vscode,visualstudio' && (await js("document.getElementById('keymap-preset')?.value")) === 'vscode')
  },
  { userData: { 'settings.json': JSON.stringify({ keymapPreset: 'vscode' }) } }
)
