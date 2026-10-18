// @ts-check
// Empty state, tab and tree context menus, and the guard against silently discarding unsaved edits.
// (Not clicked: "Reveal in File Explorer", which would open a real Explorer window.)
const { clipboard } = require('electron')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('menus', { 'a.txt': 'aaa\n', 'b.txt': 'bbb\n', 'c.txt': 'ccc\n' }, async (t) => {
  const { js, key, type, waitFor, check, root, sleep } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const tabNames = () => js("[...document.querySelectorAll('#tabs .tab')].map((t) => t.textContent.replace('●', '').trim())")
  const menuClick = (/** @type {string} */ label) =>
    js(`[...document.querySelectorAll('.ctx-item')].find(i => i.textContent === ${JSON.stringify(label)}).click()`)
  const rightClick = (/** @type {string} */ selector, /** @type {string} */ label) =>
    js(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(n => n.textContent.includes(${JSON.stringify(label)})).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 150, clientY: 150 }))`)
  const openNode = async (/** @type {string} */ name) => {
    await js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)
    await waitFor(async () => (await tabNames()).some((/** @type {string} */ n) => n.startsWith(name)), 5000)
  }

  // Empty state
  check('with no project, the Project window invites you to open one', await js("getComputedStyle(document.getElementById('empty-tree')).display !== 'none'"))
  await js("document.getElementById('open-folder-btn').click()")
  check('its button opens a folder', !!(await waitFor(async () => (await text('tree')).includes('a.txt'), 8000)))
  check('and the empty state goes away', await js("!document.getElementById('empty-tree') || !document.getElementById('tree').contains(document.getElementById('empty-tree'))"))

  // Tree menu
  await rightClick('.node', 'a.txt')
  await waitFor(() => js("document.querySelectorAll('.ctx-item').length > 0"), 3000)
  await menuClick('Copy Relative Path')
  check('Copy Relative Path puts the path on the clipboard', !!(await waitFor(() => clipboard.readText() === 'a.txt', 3000)), clipboard.readText())

  // Tab menu
  for (const f of ['a.txt', 'b.txt', 'c.txt']) await openNode(f)
  await rightClick('#tabs .tab', 'b.txt')
  await waitFor(() => js("document.querySelectorAll('.ctx-item').length > 0"), 3000)
  await menuClick('Copy Path')
  check('a tab’s Copy Path copies the file’s full path', !!(await waitFor(() => clipboard.readText() === path.join(root, 'b.txt'), 3000)), clipboard.readText())
  await rightClick('#tabs .tab', 'b.txt')
  await waitFor(() => js("document.querySelectorAll('.ctx-item').length > 0"), 3000)
  await menuClick('Close Others')
  check('Close Others keeps only that tab', !!(await waitFor(async () => (await tabNames()).join() === 'b.txt', 3000)), String(await tabNames()))

  // Unsaved edits are never discarded silently
  await js("window.__asked = []; window.confirm = (m) => { window.__asked.push(m); return false }; undefined")
  await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
  await type('X')
  await waitFor(() => js("!!document.querySelector('.tab .dot')"), 3000)
  key('W', ['control'])
  await sleep(400)
  check('closing a modified tab asks first', (await js('window.__asked.length')) === 1 && (await js('window.__asked[0]')).includes('unsaved changes'), String(await js('window.__asked')))
  check('and "no" keeps the tab (and the edit)', (await tabNames()).length === 1)
  await js("window.confirm = () => true; undefined")
  key('W', ['control'])
  check('"yes" closes it', !!(await waitFor(async () => (await tabNames()).length === 0, 3000)))
})
