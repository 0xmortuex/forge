// @ts-check
// Custom keyboard shortcuts: record one, use it, see it in the palette, refuse conflicts and modifier-less keys, remove it.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('keymap', { 'a.txt': 'x\n' }, async (t) => {
  const { js, key, type, waitFor, check, userData, sleep } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const saved = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))
    } catch {
      return {} // not written yet
    }
  }
  const settingsShown = () => js("!document.getElementById('settings').hidden")
  const row = (/** @type {string} */ title) =>
    `[...document.querySelectorAll('.keytable tr')].find(r => r.firstChild.textContent.endsWith(${JSON.stringify(title)}))`

  key(',', ['control'])
  if (!(await waitFor(settingsShown, 3000))) throw new Error('Settings did not open')
  await js('document.querySelector(\'.snav[data-cat="Keymap"]\').click()')
  await sleep(300)
  check('the Keymap page lists every command, with Set buttons', (await js("document.querySelectorAll('.keytable tr').length")) > 60 && (await js(`!!${row('Toggle Minimap')}.querySelector('.btn')`)))

  // Record Ctrl+Alt+M for "Toggle Minimap"
  await js(`${row('Toggle Minimap')}.querySelector('.btn').click()`)
  check('Set waits for a key press', (await js(`${row('Toggle Minimap')}.querySelector('.btn').textContent`)).includes('Press keys'))
  key('M', ['control', 'alt'])
  check(
    'the shortcut is recorded and shown',
    !!(await waitFor(() => js(`${row('Toggle Minimap')}.querySelectorAll('kbd.custom').length === 3`), 3000))
  )
  check('and saved in settings.json', !!(await waitFor(() => saved().keybindings?.['toggle.minimap'] === 'Ctrl+Alt+M', 3000)), JSON.stringify(saved()))

  // The binding works from anywhere
  await js("document.getElementById('settings-close').click()")
  await js("document.querySelector('#editor .monaco-editor textarea')?.focus(); undefined")
  key('M', ['control', 'alt'])
  check('pressing it runs the command', !!(await waitFor(() => saved().minimap === true, 3000)), JSON.stringify(saved()))
  key('M', ['control', 'alt'])
  check('and again runs it again', !!(await waitFor(() => saved().minimap !== true, 3000)))

  // The palette shows the custom shortcut
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await type('toggle minimap')
  await sleep(300)
  check('the palette shows the custom shortcut', (await js("[...document.querySelectorAll('#palette-results .sel kbd')].map(k => k.textContent).join('+')")) === 'Ctrl+Alt+M')
  key('Escape')

  // Refusals
  key(',', ['control'])
  await waitFor(settingsShown, 3000)
  await js('document.querySelector(\'.snav[data-cat="Keymap"]\').click()')
  await sleep(300)
  await js(`${row('Toggle Word Wrap')}.querySelector('.btn').click()`)
  key('M', ['control', 'alt'])
  check(
    'a shortcut already used by another command is refused, naming it',
    !!(await waitFor(async () => (await text('log')).includes('already used by "Toggle: Toggle Minimap"') || (await text('log')).includes('already used by'), 3000)),
    (await text('log')).slice(-300)
  )
  check('and nothing was assigned', saved().keybindings?.['editor.wrap'] === undefined)
  await js(`${row('Toggle Word Wrap')}.querySelector('.btn').click()`)
  key('K') // no modifier
  check(
    'a plain key without a modifier is refused',
    !!(await waitFor(async () => (await text('log')).includes('needs a modifier'), 3000)),
    (await text('log')).slice(-300)
  )
  await js(`${row('Toggle Word Wrap')}.querySelector('.btn').click()`)
  key('Escape')
  check('Escape cancels recording', (await js(`${row('Toggle Word Wrap')}.querySelector('.btn').textContent`)) === 'Set')

  // Removal
  await js(`${row('Toggle Minimap')}.querySelector('.btn:last-child').click()`)
  check('Remove deletes the custom shortcut', !!(await waitFor(() => saved().keybindings === undefined || saved().keybindings['toggle.minimap'] === undefined, 3000)), JSON.stringify(saved()))
  await js("document.getElementById('settings-close').click()")
  await js("document.querySelector('#editor .monaco-editor textarea')?.focus(); undefined")
  key('M', ['control', 'alt'])
  await sleep(600)
  check('and the shortcut no longer does anything', saved().minimap !== true)
})
