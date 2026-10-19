// @ts-check
// Scratch files, Compare with File / Clipboard, and the notification history behind the status bar bell.
const fs = require('node:fs')
const path = require('node:path')
const { clipboard } = require('electron')
const { run } = require('../harness.cjs')

run(
  'extras',
  { 'a.txt': 'alpha\n', 'b.txt': 'beta\n' },
  async (t) => {
    const { js, key, type, check, sleep, waitFor, userData } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const openNode = (/** @type {string} */ name) => js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)
    const quickOpen = () => js("!document.getElementById('quick').hidden")
    const quickRows = () => js("[...document.querySelectorAll('#quick-results .result')].map(r => r.textContent).join('|')")
    const tabs = () => text('tabs')
    const diffSide = (/** @type {'original' | 'modified'} */ side) => js(`(document.querySelector('#diff .editor.${side} .view-lines')?.textContent ?? '').replace(/\u00a0/g, ' ')`)
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type(query)
      await sleep(300)
      key('Enter')
      await sleep(300)
    }
    const closeDiff = async () => {
      await js("[...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes('(diff)'))?.querySelector('.close').click()")
      await waitFor(async () => !(await tabs()).includes('(diff)'), 3000)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)

    // ---- notifications ----
    check('a startup problem puts a count on the bell', !!(await waitFor(async () => (await text('st-bell')).includes('1'), 5000)), await text('st-bell'))
    await js("document.getElementById('st-bell').click()")
    await waitFor(quickOpen, 3000)
    check('clicking the bell lists notifications', (await quickRows()).includes('snippets/python.json'), await quickRows())
    key('Escape')
    await waitFor(async () => !(await quickOpen()), 2000)
    check('opening the list marks them read', !(await text('st-bell')).match(/\d/), await text('st-bell'))
    await openNode('a.txt')
    await waitFor(async () => (await tabs()).includes('a.txt'), 3000)
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('End', ['control'])
    await type('x')
    key('S', ['control'])
    check('saving a file adds a notification', !!(await waitFor(async () => (await text('st-bell')).includes('1'), 4000)), await text('st-bell'))

    // ---- scratch files ----
    await runPalette('new scratch file')
    await waitFor(quickOpen, 3000)
    await type('python')
    await sleep(200)
    key('Enter')
    check('New Scratch File opens a file of that type', !!(await waitFor(async () => (await tabs()).includes('scratch-1.py'), 4000)), await tabs())
    check('...which lives in the data folder', fs.existsSync(path.join(userData, 'scratches', 'scratch-1.py')))
    await runPalette('new scratch file')
    await waitFor(quickOpen, 3000)
    await type('python')
    await sleep(200)
    key('Enter')
    check('the next one gets the next number', !!(await waitFor(async () => (await tabs()).includes('scratch-2.py'), 4000)), await tabs())
    await runPalette('show scratch files')
    await waitFor(quickOpen, 3000)
    check('Show Scratch Files lists them', (await quickRows()).includes('scratch-1.py') && (await quickRows()).includes('scratch-2.py'), await quickRows())
    key('Escape')

    // ---- compare ----
    await openNode('a.txt')
    await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('a.txt'), 3000)
    await runPalette('compare with file')
    await waitFor(quickOpen, 3000)
    await type('b.txt')
    await sleep(200)
    key('Enter')
    check(
      'Compare with File shows the other file on the left and this one on the right',
      !!(await waitFor(async () => (await diffSide('original')).includes('beta') && (await diffSide('modified')).includes('alpha'), 5000)),
      `${await diffSide('original')} | ${await diffSide('modified')}`
    )
    await closeDiff()
    clipboard.writeText('from the clipboard')
    await runPalette('compare with clipboard')
    check(
      'Compare with Clipboard shows the clipboard text on the left',
      !!(await waitFor(async () => (await diffSide('original')).includes('from the clipboard'), 5000)),
      await diffSide('original')
    )
  },
  { userData: { 'snippets/python.json': '{ not json' } }
)
