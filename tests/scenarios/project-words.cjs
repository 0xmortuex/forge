// @ts-check
// "Complete words from the whole project" (on): a word that only exists in a file that is NOT open is offered while typing.
// Plain-text files keep the TypeScript language server out of it, and the suggestion list is asked for explicitly (Ctrl+Space)
// if typing does not open it, so the scenario tests the provider and not Monaco's trigger timing.
const { run } = require('../harness.cjs')

run(
  'project-words',
  { 'a.txt': '', 'b.txt': 'export const zebracrossingSignal = 1\nzebracrossingSignal + zebracrossingSignal\n' },
  async (t) => {
    const { js, key, type, check, sleep, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const widget = () => js("document.querySelector('.suggest-widget.visible')?.textContent ?? ''")
    const typed = () => js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('')")
    // What the backend knows, for a failure message that says why.
    const diagnosis = async () =>
      JSON.stringify({
        widget: await widget(),
        editor: await typed(),
        settingSeenByBackend: (await js("window.forge.rpc({ service: 'settings', method: 'load', args: [] })"))?.value?.settings,
        words: await js("window.forge.rpc({ service: 'fileindex', method: 'completeWord', args: ['zebracr', 20, true] })"),
        stats: await js("window.forge.rpc({ service: 'fileindex', method: 'textStats', args: [] })")
      }).slice(0, 700)

    // Typing goes through synthetic key events; if some are lost the text is typed again (up to three times).
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
    await waitFor(async () => (await text('tree')).includes('a.txt'), 20000)
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'a.txt').click()")
    await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('a.txt'), 10000)
    await sleep(500)
    await js("document.querySelector('#editor textarea').focus(); undefined")
    await sleep(200)

    await typeInEditor('zebracr')
    let shown = false
    for (let attempt = 0; attempt < 4 && !shown; attempt++) {
      shown = !!(await waitFor(async () => (await widget()).includes('zebracrossingSignal'), attempt === 0 ? 6000 : 8000))
      if (!shown) key('Space', ['control']) // typing did not open the list: ask for it
    }
    check('a word from another, unopened file is offered', shown, await diagnosis())
    key('Tab')
    check('accepting it completes the word', !!(await waitFor(async () => (await typed()).includes('zebracrossingSignal'), 4000)), await diagnosis())
  },
  { userData: { 'settings.json': JSON.stringify({ projectWords: true }) } }
)
