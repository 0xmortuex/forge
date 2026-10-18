// @ts-check
// Window shell: open folder, Search Everywhere, tool windows, tabs, editing and saving.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'shell',
  { 'alpha.txt': 'one\ntwo\n', 'src/beta.ts': 'export const beta = 1\n', 'src/gamma.ts': 'export const gamma = 2\n' },
  async (t) => {
    const { js, key, type, waitFor, check, root, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)

    key('O', ['control'])
    check('Ctrl+O populates the tree', !!(await waitFor(async () => (await text('tree')).includes('alpha.txt'), 5000)))
    check('project widget shows folder name', (await text('project-name')) === path.basename(root))
    check(
      'git UI stays hidden in a folder that is not a repository',
      !!(await waitFor(() => js("document.getElementById('branch-widget').hidden"), 3000))
    )

    // Search Everywhere: double-tap Shift, type, Enter opens the best match.
    key('Shift')
    await sleep(100)
    key('Shift')
    check('double-Shift opens Search Everywhere', !!(await waitFor(() => js("!document.getElementById('search').hidden"), 3000)))
    await type('gamma')
    await sleep(800)
    check('fuzzy search lists gamma.ts first', (await text('search-results')).startsWith('gamma.ts'))
    t.key('Enter')
    check('Enter opens the file in a tab', !!(await waitFor(async () => (await text('tabs')).includes('gamma.ts'), 5000)))
    check('Search Everywhere closes after choosing', await js("document.getElementById('search').hidden"))

    // Editing + saving
    await sleep(300)
    key('End', ['control'])
    await type('// edited')
    check('typing marks the tab dirty', !!(await waitFor(() => js("!!document.querySelector('.tab .dot')"), 3000)))
    key('S', ['control'])
    check(
      'Ctrl+S writes the file to disk',
      !!(await waitFor(() => fs.readFileSync(path.join(root, 'src', 'gamma.ts'), 'utf8').includes('// edited'), 5000))
    )
    check('dirty marker clears after save', !!(await waitFor(() => js("!document.querySelector('.tab .dot')"), 3000)))

    // Tool windows
    key('1', ['alt'])
    check('Alt+1 hides Project', !!(await waitFor(() => js("document.getElementById('project').hidden"), 2000)))
    key('1', ['alt'])
    check('Alt+1 shows Project again', !!(await waitFor(() => js("!document.getElementById('project').hidden"), 2000)))
    key('2', ['alt'])
    check('Alt+2 hides the bottom panel (Output was showing)', !!(await waitFor(() => js("document.getElementById('bottom').hidden"), 2000)))
    key('2', ['alt'])
    check('Alt+2 shows Output', !!(await waitFor(() => js("!document.getElementById('bottom').hidden && !document.getElementById('view-output').hidden"), 2000)))

    // Tabs
    key('W', ['control'])
    check('Ctrl+W closes the tab', !!(await waitFor(async () => !(await text('tabs')).includes('gamma.ts'), 3000)))
  }
)
