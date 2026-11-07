// @ts-check
// "Complete words from the whole project" (on): a word that only exists in a file that is NOT open is offered while typing.
const { run } = require('../harness.cjs')

run(
  'project-words',
  { 'a.ts': '', 'b.ts': 'export const zebracrossingSignal = 1\nzebracrossingSignal + zebracrossingSignal\n' },
  async (t) => {
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
    check('a word from another, unopened file is offered', !!(await waitFor(async () => (await widget()).includes('zebracrossingSignal'), 10000)), await widget())
    key('Tab')
    check(
      'accepting it completes the word',
      !!(await waitFor(async () => (await js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent).join('')")).includes('zebracrossingSignal'), 4000))
    )
  },
  { userData: { 'settings.json': JSON.stringify({ projectWords: true }) } }
)
