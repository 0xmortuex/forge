// @ts-check
// Terminal, project-wide search, and file operations from the tree's context menu.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'workspace',
  {
    'a.txt': 'hello\nline two has needle here\nbye\n',
    'sub/b.ts': 'const x = 1\nconst needle = 2\n',
    'bin.dat': Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0, 1, 2]).toString('latin1')
  },
  async (t) => {
    const { js, key, type, enter, waitFor, check, root, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)

    // Terminal
    key('3', ['alt'])
    await waitFor(() => js("document.querySelector('#term .xterm-rows')?.textContent.includes('PS ')"), 20000)
    await type('echo FORGE-$(1+2)')
    enter()
    const term = await waitFor(async () => {
      const s = await js("document.querySelector('#term .xterm-rows')?.textContent ?? ''")
      return s.includes('FORGE-3') && s
    }, 15000)
    check('terminal runs a command and shows output', !!term)
    check('terminal starts in the project folder', !!term && term.includes(path.basename(root)))

    // Find in project
    key('F', ['control', 'shift'])
    await sleep(500)
    await type('needle')
    enter()
    check(
      'find reports 2 matches (binary file skipped)',
      !!(await waitFor(async () => (await text('find-count')).startsWith('2 matches'), 8000)),
      await text('find-count')
    )
    await js("[...document.querySelectorAll('.hit')].find(h => h.textContent.includes('a.txt')).click()")
    check(
      'clicking a hit opens the file at that line',
      !!(await waitFor(async () => (await text('st-pos')).startsWith('2:') && (await text('tabs')).includes('a.txt'), 5000))
    )

    // File operations
    const ctxClick = (/** @type {string} */ label) =>
      js(`[...document.querySelectorAll('.ctx-item')].find(i => i.textContent.startsWith(${JSON.stringify(label)})).click()`)
    const ask = (/** @type {string} */ value) =>
      js(`(() => { const i = document.getElementById('ask-input'); i.value = ${JSON.stringify(value)}; document.getElementById('ask-box').requestSubmit() })()`)
    const rightClickRow = (/** @type {string} */ name) =>
      js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }))`)
    const exists = (/** @type {string} */ name) => fs.existsSync(path.join(root, name))

    await js("document.getElementById('tree').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }))")
    await sleep(200)
    await ctxClick('New File')
    await sleep(200)
    await ask('new.md')
    check('create file: exists on disk', !!(await waitFor(() => exists('new.md'), 5000)))
    check('create file: shows in tree', !!(await waitFor(async () => (await text('tree')).includes('new.md'), 5000)))

    await rightClickRow('new.md')
    await sleep(200)
    await ctxClick('Rename')
    await sleep(200)
    await ask('renamed.md')
    check('rename: new name on disk, old gone', !!(await waitFor(() => exists('renamed.md') && !exists('new.md'), 5000)))

    await rightClickRow('renamed.md')
    await sleep(200)
    await ctxClick('Rename')
    await sleep(200)
    await ask('a.txt')
    await sleep(800)
    check(
      'rename onto an existing file is refused and reported',
      exists('renamed.md') && fs.readFileSync(path.join(root, 'a.txt'), 'utf8').includes('needle') &&
        (await text('status-msg')).includes('Already exists')
    )

    await rightClickRow('renamed.md')
    await sleep(200)
    await ctxClick('Delete')
    check('delete: removed from disk', !!(await waitFor(() => !exists('renamed.md'), 5000)))
    check('delete: removed from tree', !!(await waitFor(async () => !(await text('tree')).includes('renamed.md'), 5000)))
  }
)
