// @ts-check
// "Finish the line from your project" is off by default: no ghost text, even though the project teaches the pattern. The
// positive control (the same typing with the setting on) is the local-inline scenario.
const { run } = require('../harness.cjs')

const known = Array.from({ length: 4 }, () => 'const result = await loadAccount(request)').join('\n') + '\n'

run('local-inline-off', { 'a.ts': '', 'b.ts': known }, async (t) => {
  const { js, key, type, check, sleep, waitFor } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const ghost = () => js("[...document.querySelectorAll('#editor .ghost-text, #editor .ghost-text-decoration')].map(e => e.textContent).join('')")

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)
  await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'a.ts').click()")
  await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('a.ts'), 3000)
  await sleep(500)
  await js("document.querySelector('#editor textarea').focus(); undefined")
  await sleep(200)

  await type('const result = await ')
  await sleep(3000) // long enough for the provider to have answered if it were on
  check('no ghost text with the setting off', (await ghost()) === '', await ghost())
})
