// @ts-check
// File commands: Reopen Closed Tab, Save All, Reload from Disk, Close Other Tabs, Rename File (Shift+F6), New File.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'file-commands',
  { 'a.txt': 'alpha\n', 'b.txt': 'bravo\n', 'c.txt': 'charlie\n' },
  async (t) => {
    const { js, key, type, enter, check, sleep, waitFor, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const tabs = () => js("[...document.querySelectorAll('#tabs .tab')].map(t => t.textContent.replace('●', '').trim()).join(',')")
    const activeTab = () => js("document.querySelector('.tab.active')?.textContent ?? ''")
    const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\u00a0/g, ' ')).filter(Boolean).join('|')")
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await sleep(400)
      await type(query)
      await sleep(600)
      key('Enter')
      await sleep(400)
    }
    const open = async (/** @type {string} */ name) => {
      await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
      await waitFor(async () => (await activeTab()).includes(name), 3000)
      await waitFor(async () => (await editorText()).length > 0, 3000)
      await js("document.querySelector('#editor textarea').focus(); undefined")
      await sleep(300)
    }
    const read = (/** @type {string} */ name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n')

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('c.txt'), 5000)
    await js('window.confirm = () => true; undefined')

    for (const n of ['a.txt', 'b.txt', 'c.txt']) await open(n)
    key('W', ['control'])
    check('Ctrl+W closes c.txt', !!(await waitFor(async () => (await tabs()) === 'a.txt,b.txt', 3000)), await tabs())
    await runPalette('Reopen Closed Tab')
    check('Reopen Closed Tab brings c.txt back', !!(await waitFor(async () => (await activeTab()).includes('c.txt'), 3000)), await tabs())

    // Save All: edit two files, neither saved
    await open('a.txt')
    key('End', ['control'])
    await type('A1')
    await open('b.txt')
    key('End', ['control'])
    await type('B1')
    await runPalette('Save All')
    check('Save All writes every modified file', !!(await waitFor(() => read('a.txt').includes('A1') && read('b.txt').includes('B1'), 4000)), `${read('a.txt')}|${read('b.txt')}`)

    // Reload from Disk drops unsaved edits
    await open('c.txt')
    key('End', ['control'])
    await type('JUNK')
    check('typing marks the file modified', !!(await waitFor(async () => (await editorText()).includes('JUNK'), 4000)))
    await runPalette('Reload from Disk')
    check('Reload from Disk restores the saved text', !!(await waitFor(async () => (await editorText()) === 'charlie', 4000)), await editorText())

    // Rename with Shift+F6
    await open('c.txt')
    key('F6', ['shift'])
    await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
    await js("document.getElementById('ask-input').select(); undefined")
    await type('renamed.txt')
    enter()
    check('Shift+F6 renames the open file', !!(await waitFor(() => fs.existsSync(path.join(root, 'renamed.txt')) && !fs.existsSync(path.join(root, 'c.txt')), 5000)))

    // New File
    await runPalette('New File')
    await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
    await js("document.getElementById('ask-input').select(); undefined")
    await type('fresh.txt')
    enter()
    check('New File creates it next to the current file', !!(await waitFor(() => fs.existsSync(path.join(root, 'fresh.txt')), 5000)))

    // Close Other Tabs
    await open('a.txt')
    await runPalette('Close Other Tabs')
    check('Close Other Tabs leaves only the current tab', !!(await waitFor(async () => (await tabs()) === 'a.txt', 4000)), await tabs())
  }
)
