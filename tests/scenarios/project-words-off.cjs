// @ts-check
// "Complete words from the whole project" is off by default: nothing from unopened files is offered. A word typed in the
// open file itself is still suggested, which proves the suggestion list works in this run (so "absent" means absent).
const { run } = require('../harness.cjs')

run('project-words-off', { 'a.ts': '', 'b.ts': 'export const zebracrossingSignal = 1\nzebracrossingSignal + zebracrossingSignal\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const widget = () => js("document.querySelector('.suggest-widget.visible')?.textContent ?? ''")

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)
  await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'a.ts').click()")
  await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('a.ts'), 3000)
  await sleep(500)
  await js("document.querySelector('#editor textarea').focus(); undefined")
  await sleep(200)

  await type('zebracr')
  await sleep(3000) // long enough for the provider to have answered if it were on
  check('no word from the unopened file is offered', !(await widget()).includes('zebracrossingSignal'), await widget())

  // Control: a word from this very file is suggested, so the widget does work here.
  key('A', ['control'])
  key('Delete')
  await type('localwordexample ')
  await type('localw')
  check('the suggestion list works in this run (a word from the open file is offered)', !!(await waitFor(async () => (await widget()).includes('localwordexample'), 8000)), await widget())
})
