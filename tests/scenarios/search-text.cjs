// @ts-check
// Search Everywhere's Text scope: finds lines inside files through the project's text index, and opens the file at that line.
const { run } = require('../harness.cjs')

run('search-text', { 'a.txt': 'alpha\nsecond Distinctive-Token line\nomega\n', 'b.txt': 'nothing to see here\n', 'blob.bin': 'distinctive-token\u0000binary\n' }, async (t) => {
  const { js, key, type, enter, check, sleep, waitFor } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const rows = () => js("[...document.querySelectorAll('#search-results .result')].map(e => e.textContent).join('|')")

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await sleep(400)
  await type('Find Text in Project')
  await sleep(600)
  key('Enter')
  check('the command opens Search Everywhere on the Text scope', !!(await waitFor(() => js("!document.getElementById('search').hidden && document.querySelector('.scope-chip.on')?.dataset.scope === 'text'"), 3000)))
  check('it says how many characters are needed', (await text('search-results')).includes('at least 3 characters'), await text('search-results'))

  await type('distinctive-tok')
  const found = await waitFor(async () => {
    const r = await rows()
    return r.includes('Distinctive-Token') ? r : null
  }, 8000)
  check('it finds the line, ignoring case, with the file and line number', !!found && found.includes('a.txt:2'), String(found ?? (await text('search-results'))))
  check('a binary file is not searched', !String(found).includes('blob.bin'), String(found))

  enter()
  check(
    'Enter opens the file at that line',
    !!(await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('a.txt') && (await text('st-pos')).startsWith('2:'), 5000)),
    `${await js("document.querySelector('.tab.active')?.textContent ?? ''")} ${await text('st-pos')}`
  )
})
