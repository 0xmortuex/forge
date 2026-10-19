// @ts-check
// Spell checking: typos in prose and comments are underlined, words used as identifiers are not, Quick Fix corrects or adds a
// word to the dictionary, and the setting turns it off.
const { run } = require('../harness.cjs')

run(
  'spell',
  {
    'notes.md': 'This is a mispelled wrod in the documentation.\n',
    'code.ts': 'export const recieverCount = 1 // the reciever is counted here\n// we recieve data from the quik source\n'
  },
  async (t) => {
    const { js, key, type, check, sleep, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const squiggles = () => js("document.querySelectorAll('#editor [class*=\"squiggly-info\"]').length")
    const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('\\n')")
    const open = async (/** @type {string} */ name) => {
      await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
      await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes(name), 3000)
      await sleep(500)
      await js("document.querySelector('#editor textarea').focus(); undefined")
      await sleep(200)
    }
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await sleep(400)
      await type(query)
      await sleep(600)
      key('Enter')
      await sleep(400)
    }
    const goTo = async (/** @type {number} */ column) => {
      key('Home', ['control'])
      for (let i = 0; i < column; i++) key('Right')
      await sleep(200)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('notes.md'), 5000)

    // ---- prose ----
    await open('notes.md')
    check('two typos are underlined (the correct words are not)', !!(await waitFor(async () => (await squiggles()) === 2, 15000)), String(await squiggles()))

    // Quick Fix on "wrod".
    await goTo(22)
    key('.', ['control'])
    await sleep(900)
    check('Ctrl+. offers corrections', (await js("document.body.textContent")).includes('Change to'), '')
    key('Enter')
    check('applying the first one fixes the word', !!(await waitFor(async () => !(await editorText()).includes('wrod') && /mispelled \w+ in/.test(await editorText()), 5000)), await editorText())
    check('...leaving one typo', !!(await waitFor(async () => (await squiggles()) === 1, 6000)), String(await squiggles()))

    // Add "mispelled" to the dictionary.
    await goTo(12)
    await runPalette('Add Word at Cursor to Dictionary')
    check('adding a word to the dictionary removes its underline', !!(await waitFor(async () => (await squiggles()) === 0, 6000)), String(await squiggles()))

    // ---- code ----
    await open('code.ts')
    check('in code, comments are checked, but a word used as an identifier is not reported', !!(await waitFor(async () => (await squiggles()) === 2, 15000)), String(await squiggles()))

    // ---- the setting ----
    key(',', ['control'])
    await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
    await js("document.querySelector('.snav[data-cat=\"Editor\"]').click()")
    await sleep(500)
    await js("[...document.querySelectorAll('.srow')].find(r => r.querySelector('.label')?.textContent === 'Check spelling').querySelector('.switch').click()")
    await js("document.getElementById('settings-close').click()")
    check('turning the setting off removes the underlines', !!(await waitFor(async () => (await squiggles()) === 0, 8000)), String(await squiggles()))
  }
)
