// @ts-check
// "Finish the line from your project" (on): a model trained on the project's files proposes the rest of the line as ghost
// text, from the words typed so far, and Tab accepts it. Nothing is sent to any server.
const { run } = require('../harness.cjs')

const known = Array.from({ length: 4 }, () => 'const result = await loadAccount(request)').join('\n') + '\n'

run(
  'local-inline',
  { 'a.ts': '', 'b.ts': known },
  async (t) => {
    const { js, key, type, check, sleep, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const ghost = () => js("[...document.querySelectorAll('#editor .ghost-text, #editor .ghost-text-decoration')].map(e => e.textContent).join('')")
    const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('')")

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'a.ts').click()")
    await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('a.ts'), 3000)
    await sleep(500)
    await js("document.querySelector('#editor textarea').focus(); undefined")
    await sleep(200)

    // A trailing space: the model proposes the next word and the rest of the line (no suggestion list is open to take Tab).
    await type('const result = await ')
    check('the rest of the line shows as ghost text', !!(await waitFor(async () => (await ghost()).includes('loadAccount(request)'), 10000)), await ghost())
    key('Tab')
    check('Tab accepts it', !!(await waitFor(async () => (await editorText()).includes('const result = await loadAccount(request)'), 4000)), await editorText())
  },
  { userData: { 'settings.json': JSON.stringify({ localInline: true }) } }
)
