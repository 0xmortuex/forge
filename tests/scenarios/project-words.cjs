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
    // What the backend knows, for a failure message that says why.
    const diagnosis = async () =>
      JSON.stringify({
        widget: await widget(),
        words: await js("window.forge.rpc({ service: 'fileindex', method: 'completeWord', args: ['zebracr', 20, true] })"),
        stats: await js("window.forge.rpc({ service: 'fileindex', method: 'textStats', args: [] })")
      }).slice(0, 600)

    // Typing goes through synthetic key events; if some are lost the text is typed again (up to three times) instead of the
    // check failing for a reason that has nothing to do with the feature.
    const typed = () => js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('')")
    const typeInEditor = async (/** @type {string} */ str) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await type(str)
        if (await waitFor(async () => (await typed()).includes(str), 2000)) return
        key('A', ['control'])
        key('Delete')
        await sleep(300)
      }
      throw new Error('the keystrokes never arrived in the editor: ' + str)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'a.ts').click()")
    await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('a.ts'), 3000)
    await sleep(500)
    await js("document.querySelector('#editor textarea').focus(); undefined")
    await sleep(200)

    await typeInEditor('zebracr')
    check('a word from another, unopened file is offered', !!(await waitFor(async () => (await widget()).includes('zebracrossingSignal'), 10000)), await diagnosis())
    key('Tab')
    check(
      'accepting it completes the word',
      !!(await waitFor(async () => (await js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent).join('')")).includes('zebracrossingSignal'), 4000))
    )
  },
  { userData: { 'settings.json': JSON.stringify({ projectWords: true }) } }
)
