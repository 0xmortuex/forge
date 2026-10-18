// @ts-check
// Multiple terminals: independent shells, tabs, switching, closing, exited shells, shortcut.
const { run } = require('../harness.cjs')

run('terminals', { 'a.txt': 'x\n' }, async (t) => {
  const { js, key, type, enter, waitFor, check, sleep } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const tabs = () => js("[...document.querySelectorAll('#term-tabs .ttab .tname')].map((n) => n.textContent)")
  const visibleText = () => js("document.querySelector('.term-pane:not([hidden]) .xterm-rows')?.textContent ?? ''")
  const paneText = (/** @type {number} */ i) => js(`document.querySelectorAll('.term-pane')[${i}]?.querySelector('.xterm-rows')?.textContent ?? ''`)
  const focusVisible = () => js("document.querySelector('.term-pane:not([hidden]) .xterm-helper-textarea').focus(); undefined")
  const clickTab = (/** @type {number} */ i) => js(`document.querySelectorAll('#term-tabs .ttab')[${i}].click()`)

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)

  key('3', ['alt'])
  check('opening Terminal creates the first tab', !!(await waitFor(async () => (await tabs()).join() === 'Local', 10000)), String(await tabs()))
  await waitFor(async () => (await visibleText()).includes('PS '), 20000)
  await focusVisible()
  await type('echo ONE-$(1+1)')
  enter()
  check('first terminal runs a command', !!(await waitFor(async () => (await visibleText()).includes('ONE-2'), 15000)))

  await js("document.getElementById('term-new').click()")
  check('+ adds a second tab and activates it', !!(await waitFor(async () => (await tabs()).join() === 'Local,Local (2)', 5000)), String(await tabs()))
  await waitFor(async () => (await visibleText()).includes('PS '), 20000)
  check('the new terminal starts empty (own session)', !(await visibleText()).includes('ONE-2'))
  await focusVisible()
  await type('echo TWO-$(1+2)')
  enter()
  check('second terminal runs its own command', !!(await waitFor(async () => (await visibleText()).includes('TWO-3'), 15000)))

  await clickTab(0)
  await sleep(500)
  check('switching back shows the first terminal intact', (await visibleText()).includes('ONE-2') && !(await visibleText()).includes('TWO-3'))
  check('the other terminal kept its own output', (await paneText(1)).includes('TWO-3'))

  // A shell that exits is marked, not silently removed
  await focusVisible()
  await type('exit')
  enter()
  check(
    'an exited shell is marked in its tab',
    !!(await waitFor(() => js("document.querySelectorAll('#term-tabs .ttab.exited').length === 1"), 10000))
  )
  check('its output reports the exit', !!(await waitFor(async () => (await paneText(0)).includes('process exited'), 5000)))

  // Closing tabs
  await js("document.querySelectorAll('#term-tabs .ttab .close')[0].click()")
  check('closing a tab removes it', !!(await waitFor(async () => (await tabs()).join() === 'Local (2)', 5000)), String(await tabs()))
  check('the remaining terminal is shown and still works', (await visibleText()).includes('TWO-3'))

  // Shortcut opens another
  key('`', ['control', 'shift'])
  check('Ctrl+Shift+` opens a new terminal', !!(await waitFor(async () => (await tabs()).length === 2, 5000)), String(await tabs()))
  await js("document.querySelectorAll('#term-tabs .ttab .close')[1].click()")
  await js("document.querySelectorAll('#term-tabs .ttab .close')[0].click()")
  check('closing every tab leaves just the + button', !!(await waitFor(async () => (await tabs()).length === 0, 5000)))
  key('3', ['alt']) // hides the bottom panel
  key('3', ['alt']) // shows Terminal again: with no terminals, one is created
  check('reopening with no terminals starts a fresh one', !!(await waitFor(async () => (await tabs()).length === 1, 10000)))
})
