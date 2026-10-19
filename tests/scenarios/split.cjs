// @ts-check
// Split editor: a second pane sharing the file's text, saving from it, moving files, orientation, closing.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('split', { 'a.txt': 'alpha\n', 'b.txt': 'beta\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor, root, wc } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const lines = (/** @type {string} */ sel) => js(`[...document.querySelectorAll('${sel} .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('|')`)
  const tab = (/** @type {string} */ name) => `[...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes(${JSON.stringify(name)}))`
  const paneOpen = () => js("!document.getElementById('pane2').hidden")

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  for (const n of ['a.txt', 'b.txt']) {
    await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(n)}).click()`)
    await waitFor(async () => (await text('tabs')).includes(n), 3000)
  }

  check('no split to begin with', !(await paneOpen()))
  await js(`${tab('a.txt')}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 60 }))`)
  await sleep(250)
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === 'Split Right').click()")
  check('a tab\'s menu splits the editor to the right', !!(await waitFor(paneOpen, 3000)))
  check('...showing that file in the second pane', !!(await waitFor(async () => (await lines('#editor2')).includes('alpha'), 4000)), await lines('#editor2'))
  check('...while the main pane keeps the tab you were on', (await lines('#editor')).includes('beta'), await lines('#editor'))
  check('the second pane has a header naming the file', (await text('pane2-name')) === 'a.txt')

  // ---- both panes edit the same text ----
  await js("document.querySelector('#editor2 .monaco-editor textarea').focus(); undefined")
  key('End', ['control'])
  await type('from the split')
  check('typing in the split shows up in the main editor\'s file too', !!(await waitFor(async () => (await js("!!document.querySelector('.tab .dot')")), 3000)))
  key('S', ['control'])
  check('Ctrl+S inside the split saves its file', !!(await waitFor(() => fs.readFileSync(path.join(root, 'a.txt'), 'utf8').includes('from the split'), 4000)), fs.readFileSync(path.join(root, 'a.txt'), 'utf8'))
  check('...and the tab is clean again', !!(await waitFor(async () => !(await js("!!document.querySelector('.tab .dot')")), 3000)))

  // ---- the same file in both panes ----
  await js(`${tab('a.txt')}.click()`)
  await waitFor(async () => (await lines('#editor')).includes('alpha'), 3000)
  await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
  key('Home', ['control'])
  await type('>>')
  check('typing in the main editor appears in the split', !!(await waitFor(async () => (await lines('#editor2')).includes('>>alpha'), 3000)), await lines('#editor2'))

  // ---- swap, orientation, close ----
  await js(`${tab('b.txt')}.click()`)
  await waitFor(async () => (await lines('#editor')).includes('beta'), 3000)
  await js("document.getElementById('pane2-swap').click()")
  check('the swap button brings the split\'s file to the main editor', !!(await waitFor(async () => (await lines('#editor')).includes('alpha'), 3000)))
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await type('split down')
  await sleep(300)
  key('Enter')
  check('Split Down stacks the panes', !!(await waitFor(() => js("document.getElementById('editors').classList.contains('stack')"), 3000)))
  await js("document.getElementById('pane2-close').click()")
  check('the close button removes the split', !!(await waitFor(async () => !(await paneOpen()), 3000)))

  // ---- closing the file closes its split ----
  await js(`${tab('b.txt')}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 60 }))`)
  await sleep(250)
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === 'Split Right').click()")
  await waitFor(paneOpen, 3000)
  await js(`${tab('b.txt')}.querySelector('.close').click()`)
  check('closing the file closes the split that shows it', !!(await waitFor(async () => !(await paneOpen()), 3000)))
  void wc
})
