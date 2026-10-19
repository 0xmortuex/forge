// @ts-check
// "Show History for Selection": only the commits that touched the selected lines, with just those lines' diff.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('git-selection-history', { 'f.txt': 'A\nB\nC\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor, root } = t
  const git = (/** @type {string[]} */ ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const edit = (/** @type {string} */ body, /** @type {string} */ msg) => {
    fs.writeFileSync(path.join(root, 'f.txt'), body)
    git('add', '-A')
    git('commit', '-q', '-m', msg)
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'T')
  git('config', 'user.email', 't@t')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'add file')
  edit('A\nB2\nC\n', 'change B')
  edit('A\nB2\nC2\n', 'change C')
  edit('A2\nB2\nC2\n', 'change A')

  const runPalette = async (/** @type {string} */ query) => {
    key('P', ['control', 'shift'])
    await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
    await sleep(400)
    await type(query)
    await sleep(600)
    key('Enter')
    await sleep(400)
  }
  const subjects = () => js("[...document.querySelectorAll('#selhist-list .selhist-subject')].map(e => e.textContent).join('|')")

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('f.txt'), 5000)
  await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'f.txt').click()")
  await waitFor(async () => (await js("document.querySelector('#editor .view-lines')?.textContent ?? ''")).includes('B2'), 5000)

  // ---- one line ----
  await js("document.querySelector('#editor textarea').focus(); undefined")
  key('Home', ['control'])
  key('Down')
  key('Home')
  key('End', ['shift'])
  await sleep(300)
  await runPalette('Show History for Selection')
  check('the dialog opens', !!(await waitFor(() => js("!!document.getElementById('selhistory')"), 6000)))
  check('only the commits that touched line 2 are listed, newest first', (await subjects()) === 'change B|add file', await subjects())
  check('the title names the line', (await text('selhistory')).includes('line 2'), (await text('selhistory')).slice(0, 80))
  const first = await text('selhist-patch')
  check('the diff shows that line\'s change', first.includes('-B') && first.includes('+B2'), first)
  check('...and nothing from the other lines', !first.includes('C2') && !first.includes('A2'), first)
  await js("document.querySelectorAll('#selhist-list .selhist-commit')[1].click()")
  check('picking an older commit shows its diff', !!(await waitFor(async () => (await text('selhist-patch')).includes('+B'), 3000)), await text('selhist-patch'))
  await js("document.getElementById('selhist-close').click()")
  check('Close dismisses it', !!(await waitFor(() => js("!document.getElementById('selhistory')"), 3000)))

  // ---- every line ----
  await js("document.querySelector('#editor textarea').focus(); undefined")
  key('A', ['control'])
  await sleep(300)
  await runPalette('Show History for Selection')
  await waitFor(() => js("!!document.getElementById('selhistory')"), 6000)
  check('selecting everything lists all four commits', (await subjects()) === 'change A|change C|change B|add file', await subjects())
  key('Escape')
  check('Escape closes the dialog', !!(await waitFor(() => js("!document.getElementById('selhistory')"), 3000)))
})
