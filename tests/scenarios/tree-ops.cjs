// @ts-check
// Project tree: cut / copy / paste, duplicate, drag and drop to move, Open in Terminal, Find in Files here, hidden files.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('tree-ops', { 'a.txt': 'alpha\n', 'dir1/x.txt': 'x\n', 'dir2/keep.txt': 'k\n', '.hidden.txt': 'h\n' }, async (t) => {
  const { js, key, type, enter, check, sleep, waitFor, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const node = (/** @type {string} */ name) => `[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)})`
  const has = (/** @type {string} */ name) => js(`!!${node(name)}`)
  const abs = (/** @type {string[]} */ ...p) => path.join(root, ...p)
  // A name can appear in several folders: "dir1/a.txt" picks that one, a bare name the first match.
  const nodeOf = (/** @type {string} */ name) => (name.includes('/') ? `[...document.querySelectorAll('.node')].find(n => n.dataset.path === ${JSON.stringify(abs(...name.split('/')))})` : node(name))
  const menu = async (/** @type {string} */ name, /** @type {string} */ label) => {
    await js(`${nodeOf(name)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }))`)
    await sleep(250)
    await js(`[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.startsWith(${JSON.stringify(label)})).click()`)
    await sleep(500)
  }
  const drag = (/** @type {string} */ from, /** @type {string} */ to) =>
    js(`(() => { const dt = new DataTransfer(); ${nodeOf(from)}.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); ${node(to)}.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); ${node(to)}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })) })()`)
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
  await js(`${node('dir1')}.click()`)
  await js(`${node('dir2')}.click()`)
  await waitFor(async () => (await has('x.txt')) && (await has('keep.txt')), 4000)

  // ---- hidden files ----
  check('hidden files are shown by default', await has('.hidden.txt'))
  await runPalette('toggle hidden files')
  check('the toggle hides them', !!(await waitFor(async () => !(await has('.hidden.txt')), 4000)))
  await runPalette('toggle hidden files')
  check('...and shows them again', !!(await waitFor(() => has('.hidden.txt'), 4000)))

  // ---- copy / paste ----
  await menu('a.txt', 'Copy')
  await menu('dir1', 'Paste into')
  check('Copy + Paste puts a copy in the folder', !!(await waitFor(() => fs.existsSync(abs('dir1', 'a.txt')), 4000)))
  check('...and the original stays', fs.existsSync(abs('a.txt')))
  await menu('dir1', 'Paste into')
  check('pasting again picks a free name', !!(await waitFor(() => fs.existsSync(abs('dir1', 'a copy.txt')), 4000)))

  // ---- cut / paste ----
  await menu('x.txt', 'Cut')
  await menu('dir2', 'Paste into')
  check('Cut + Paste moves the file', !!(await waitFor(() => fs.existsSync(abs('dir2', 'x.txt')) && !fs.existsSync(abs('dir1', 'x.txt')), 4000)))
  check('...and the tree shows it in its new place', !!(await waitFor(async () => (await js(`${node('x.txt')}?.dataset.path ?? ''`)).includes('dir2'), 4000)))

  // ---- duplicate ----
  await menu('./a.txt', 'Duplicate')
  await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
  check('Duplicate suggests a free name', (await js("document.getElementById('ask-input').value")) === 'a copy.txt')
  enter()
  check('...and makes the copy', !!(await waitFor(() => fs.existsSync(abs('a copy.txt')), 4000)))

  // ---- drag and drop ----
  await waitFor(() => has('a copy.txt'), 4000)
  await drag('./a copy.txt', 'dir2')
  check('dragging a file onto a folder moves it', !!(await waitFor(() => fs.existsSync(abs('dir2', 'a copy.txt')) && !fs.existsSync(abs('a copy.txt')), 4000)))

  // ---- Find in Files here ----
  await menu('dir2', 'Find in Files')
  check('Find in Files… limits the search to that folder', !!(await waitFor(async () => (await js("document.getElementById('find-mask').value")) === 'dir2/**', 3000)), await js("document.getElementById('find-mask').value"))

  // ---- Open in Terminal ----
  await menu('dir1', 'Open in Terminal')
  check('Open in Terminal starts a shell there', !!(await waitFor(async () => (await js("document.querySelector('#term .term-pane:not([hidden]) .xterm-rows')?.textContent ?? ''")).includes('dir1'), 20000)))
})
