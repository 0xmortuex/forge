// @ts-check
// Local History: a snapshot when a file is opened and each time it is saved; compare with an earlier version; restore one.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'history',
  { 'a.txt': 'one\n' },
  async (t) => {
    const { js, key, type, enter, check, sleep, waitFor, userData } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const quickOpen = () => js("!document.getElementById('quick').hidden")
    const quickRows = () => js("[...document.querySelectorAll('#quick-results .result')].map(r => r.textContent).join('|')")
    const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('|')")
    const snapshots = () => {
      const root = path.join(userData, 'history')
      if (!fs.existsSync(root)) return []
      /** @type {string[]} */
      const out = []
      for (const dir of fs.readdirSync(root)) for (const f of fs.readdirSync(path.join(root, dir))) if (/^\d+\.txt$/.test(f)) out.push(fs.readFileSync(path.join(root, dir, f), 'utf8'))
      return out
    }
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type(query)
      await sleep(300)
      key('Enter')
      await sleep(300)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'a.txt').click()")
    check('opening a file stores its first snapshot', !!(await waitFor(() => snapshots().length === 1, 4000)), String(snapshots().length))

    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('End', ['control'])
    await type('edited')
    // Typing reaches the editor asynchronously: save only once all of it is there, or the snapshot could miss its end.
    await waitFor(() => js("[...document.querySelectorAll('#editor .view-line')].some(l => l.textContent.includes('edited'))"), 4000)
    key('S', ['control'])
    check('saving stores another', !!(await waitFor(() => snapshots().length === 2, 4000)), String(snapshots().length))
    check('...holding the saved text', snapshots().some((s) => s.includes('edited')))
    key('S', ['control'])
    await sleep(500)
    check('saving again without changes stores nothing new', snapshots().length === 2, String(snapshots().length))

    // ---- compare ----
    await runPalette('show local history')
    check('Show Local History lists the versions, newest first', !!(await waitFor(async () => (await quickOpen()) && (await js("document.querySelectorAll('#quick-results .result').length")) === 2, 4000)), await quickRows())
    check('...marking the latest', (await quickRows()).includes('latest'), await quickRows())
    key('Down')
    key('Enter')
    check('choosing an older one opens a diff against it', !!(await waitFor(async () => (await text('tabs')).includes('(diff)'), 4000)), await text('tabs'))
    check(
      'the left side is the old text, the right side the current text',
      !!(await waitFor(async () => {
        const left = await js("document.querySelector('#diff .editor.original .view-lines')?.textContent ?? ''")
        const right = await js("document.querySelector('#diff .editor.modified .view-lines')?.textContent ?? ''")
        return left.includes('one') && !left.includes('edited') && right.includes('edited')
      }, 4000))
    )
    await js("[...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes('(diff)')).querySelector('.close').click()")
    await waitFor(async () => !(await text('tabs')).includes('(diff)'), 3000)

    // ---- restore ----
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    await runPalette('restore from local history')
    await waitFor(quickOpen, 3000)
    key('Down')
    key('Enter')
    check('restoring puts the old text into the editor', !!(await waitFor(async () => !(await editorText()).includes('edited'), 4000)), await editorText())
    check('...without saving it: the tab shows unsaved changes', !!(await js("!!document.querySelector('.tab .dot')")))
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('Z', ['control'])
    check('Ctrl+Z brings the other text back', !!(await waitFor(async () => (await editorText()).includes('edited'), 4000)), await editorText())
  }
)
