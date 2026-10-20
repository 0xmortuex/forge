// @ts-check
// Split terminal: a second shell beside the first in the same tab, each with its own session; exiting a split closes its half.
const { run } = require('../harness.cjs')

run('terminal-split', { 'a.txt': 'x\n' }, async (t) => {
  const { js, key, type, enter, waitFor, check } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const cells = () => js("document.querySelectorAll('.term-pane:not([hidden]) .term-cell').length")
  const cellText = (/** @type {number} */ i) => js(`document.querySelectorAll('.term-pane:not([hidden]) .term-cell')[${i}]?.querySelector('.xterm-rows')?.textContent ?? ''`)
  const focusCell = (/** @type {number} */ i) => js(`document.querySelectorAll('.term-pane:not([hidden]) .term-cell')[${i}].querySelector('.xterm-helper-textarea').focus(); undefined`)

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  key('3', ['alt'])
  await waitFor(async () => (await cellText(0)).includes('PS '), 20000)
  check('a new tab starts with one shell', (await cells()) === 1)

  await js("document.getElementById('term-split').click()")
  check('Split adds a second shell in the same tab', !!(await waitFor(async () => (await cells()) === 2, 5000)))
  check('there is still one tab', (await js("document.querySelectorAll('#term-tabs .ttab').length")) === 1)
  await waitFor(async () => (await cellText(1)).includes('PS '), 20000)
  const rects = await js("[...document.querySelectorAll('.term-pane:not([hidden]) .term-cell')].map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)] })")
  check('they sit side by side with similar widths', rects[1][0] > rects[0][0] + rects[0][1] - 4 && Math.abs(rects[0][1] - rects[1][1]) < 40 && rects[0][2] > 50, JSON.stringify(rects))

  await focusCell(0)
  await type('echo LEFT-$(1+1)')
  enter()
  await focusCell(1)
  await type('echo RIGHT-$(2+2)')
  enter()
  check('each half runs its own commands', !!(await waitFor(async () => (await cellText(0)).includes('LEFT-2') && (await cellText(1)).includes('RIGHT-4'), 15000)), `${await cellText(0)} || ${await cellText(1)}`)
  check('and neither sees the other’s output', !(await cellText(0)).includes('RIGHT-4') && !(await cellText(1)).includes('LEFT-2'))

  // Exiting the split closes only that half.
  await focusCell(1)
  await type('exit')
  enter()
  check('exiting a split closes its half', !!(await waitFor(async () => (await cells()) === 1, 10000)))
  check('the other shell is untouched', (await cellText(0)).includes('LEFT-2'))

  // Splitting from the command palette works too.
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await type('Split Terminal')
  await waitFor(() => js("document.querySelectorAll('#palette-list .item, #palette-results .item, #palette .item').length > 0"), 3000)
  key('Enter')
  check('the Split Terminal command splits too', !!(await waitFor(async () => (await cells()) === 2, 8000)))

  // Closing the tab disposes both.
  await js("document.querySelectorAll('#term-tabs .ttab .close')[0].click()")
  check('closing the tab removes both shells', !!(await waitFor(async () => (await js("document.querySelectorAll('.term-cell').length")) === 0, 8000)))
})
