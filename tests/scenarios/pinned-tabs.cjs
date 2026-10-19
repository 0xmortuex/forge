// @ts-check
// Pinned tabs: they move to the left, lose the close button, survive Ctrl+W and Close All, and are remembered.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('pinned-tabs', { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' }, async (t) => {
  const { js, key, check, sleep, waitFor, userData, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const tabNames = () => js("[...document.querySelectorAll('#tabs .tab')].map(t => t.textContent.replace('●', '').trim()).join(',')")
  const open = async (/** @type {string} */ name) => {
    await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
    await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes(name), 3000)
  }
  const tabMenu = async (/** @type {string} */ name, /** @type {string} */ label) => {
    await js(`[...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes(${JSON.stringify(name)})).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 60 }))`)
    await sleep(250)
    await js(`[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === ${JSON.stringify(label)}).click()`)
    await sleep(300)
  }

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('c.txt'), 5000)
  for (const n of ['a.txt', 'b.txt', 'c.txt']) await open(n)
  check('three tabs, in the order they were opened', (await tabNames()) === 'a.txt,b.txt,c.txt', await tabNames())

  await tabMenu('c.txt', 'Pin Tab')
  check('pinning moves the tab to the left', !!(await waitFor(async () => (await tabNames()) === 'c.txt,a.txt,b.txt', 3000)), await tabNames())
  check('a pinned tab shows a pin and has no close button', (await js("(() => { const t = [...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes('c.txt')); return !!t.querySelector('.pin') && !t.querySelector('.close') })()")) === true)
  check('the others still have close buttons', (await js("document.querySelectorAll('#tabs .tab:not(.pinned) .close').length")) === 2)

  // Ctrl+W on the pinned tab does nothing but explain.
  await open('c.txt')
  await js("document.querySelector('#editor textarea').focus(); undefined")
  key('W', ['control'])
  check('Ctrl+W does not close a pinned tab, and says why', !!(await waitFor(async () => (await text('log')).includes('This tab is pinned'), 3000)) && (await tabNames()) === 'c.txt,a.txt,b.txt', `${await tabNames()} | ${(await text('log')).slice(-120)}`)

  // Close All leaves it.
  await tabMenu('a.txt', 'Close All')
  check('Close All keeps the pinned tab', !!(await waitFor(async () => (await tabNames()) === 'c.txt', 3000)), await tabNames())

  // The pin is saved with the session.
  const statePath = path.join(userData, 'state.json')
  check('the pin is remembered in the session file', !!(await waitFor(() => fs.existsSync(statePath) && (JSON.parse(fs.readFileSync(statePath, 'utf8')).pinned ?? []).some((/** @type {string} */ p) => p.endsWith('c.txt')), 4000)), fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8').slice(0, 200) : 'no state file')

  // Unpin: normal again.
  await tabMenu('c.txt', 'Unpin Tab')
  check('unpinning gives the close button back', !!(await waitFor(() => js("!!document.querySelector('#tabs .tab .close') && !document.querySelector('#tabs .tab .pin')"), 3000)))
  await js("document.querySelector('#tabs .tab .close').click()")
  check('and the tab can be closed again', !!(await waitFor(async () => (await tabNames()) === '', 3000)), await tabNames())
  void root
})
