// @ts-check
// Interactive rebase: reorder, fixup, reword, drop and squash from the Git window, and a rebase that stops on conflicts
// (the reword written into the todo list still applies after the user resolves and continues).
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('git-rebase-interactive', { 'a.txt': 'base\n' }, async (t) => {
  const { js, key, check, sleep, waitFor, root } = t
  const git = (/** @type {string[]} */ ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  const out = (/** @type {string[]} */ ...args) => git(...args).stdout
  const write = (/** @type {string} */ name, /** @type {string} */ body) => fs.writeFileSync(path.join(root, name), body)
  const commit = (/** @type {string} */ msg) => {
    git('add', '-A')
    git('commit', '-q', '-m', msg)
  }
  const subjects = () => out('log', '--format=%s').trim().split('\n').join('|')
  const shaOf = (/** @type {string} */ subject) => out('log', '--format=%H %s').split('\n').find((l) => l.endsWith(` ${subject}`))?.split(' ')[0] ?? ''

  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'T')
  git('config', 'user.email', 't@t')
  git('config', 'commit.gpgsign', 'false')
  commit('base')
  write('one.txt', 'one with a typo: teh\n')
  commit('add one')
  write('two.txt', 'two\n')
  commit('add two')
  write('three.txt', 'three\n')
  commit('add three')
  write('one.txt', 'one with a typo: the\n')
  commit('fix typo in one')
  write('four.txt', 'four\n')
  commit('add four')

  const rowOf = (/** @type {string} */ subject) => `[...document.querySelectorAll('#view-git .gc')].find(r => r.querySelector('.gcsub').textContent === ${JSON.stringify(subject)})`
  const dialogRow = (/** @type {string} */ sha) => `document.querySelector('#rebase .rebase-row[data-sha="${sha}"]')`
  const setAction = async (/** @type {string} */ sha, /** @type {string} */ action) => {
    await js(`(() => { const s = ${dialogRow(sha)}.querySelector('.rebase-action'); s.value = ${JSON.stringify(action)}; s.dispatchEvent(new Event('change')) })()`)
    await sleep(120)
  }
  const openDialogFrom = async (/** @type {string} */ subject) => {
    await js(`${rowOf(subject)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))`)
    await sleep(250)
    await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.startsWith('Interactively Rebase')).click()")
    return !!(await waitFor(() => js("!!document.getElementById('rebase')"), 6000))
  }

  key('O', ['control'])
  await waitFor(async () => (await js("document.getElementById('tree').textContent")).includes('a.txt'), 5000)
  key('9', ['alt'])
  await waitFor(() => js("document.querySelectorAll('#view-git .gc').length === 6"), 8000)

  // ---- 1. reorder, fixup, reword, drop ----
  check('the dialog opens from a commit\'s menu', await openDialogFrom('add one'))
  check('it lists that commit and everything after it, oldest first', (await js("[...document.querySelectorAll('#rebase .rebase-subject')].map(e => e.textContent).join('|')")) === 'add one|add two|add three|fix typo in one|add four')
  const shaTwo = shaOf('add two')
  const shaThree = shaOf('add three')
  const shaFix = shaOf('fix typo in one')
  // Move the typo fix up, right after "add one", and fold it in.
  await js(`${dialogRow(shaFix)}.querySelector('.rebase-up').click()`)
  await sleep(150)
  await js(`${dialogRow(shaFix)}.querySelector('.rebase-up').click()`)
  await sleep(150)
  check('moving up reorders the rows', (await js("[...document.querySelectorAll('#rebase .rebase-subject')].map(e => e.textContent).join('|')")) === 'add one|fix typo in one|add two|add three|add four')
  await setAction(shaFix, 'fixup')
  await setAction(shaTwo, 'reword')
  check('a reworded commit gets a message box with its current message', (await js("document.querySelector('#rebase .rebase-msg')?.value ?? ''")) === 'add two')
  await js("(() => { const a = document.querySelector('#rebase .rebase-msg'); a.value = 'add two (reworded)'; a.dispatchEvent(new Event('input')) })()")
  await setAction(shaThree, 'drop')
  check('Start is enabled for a valid plan', !(await js("document.getElementById('rebase-start').disabled")))
  await js("document.getElementById('rebase-start').click()")
  check('the rebase rewrites history as planned', !!(await waitFor(() => subjects() === 'add four|add two (reworded)|add one|base', 20000)), subjects())
  check('the typo fix was folded into "add one"', out('show', 'HEAD~2:one.txt') === 'one with a typo: the\n', out('show', 'HEAD~2:one.txt'))
  check('the dropped commit\'s file is gone', !fs.existsSync(path.join(root, 'three.txt')))
  check('the working tree is clean afterwards', out('status', '--porcelain').trim() === '', out('status', '--porcelain'))
  check('no helper files are left in .git', !fs.existsSync(path.join(root, '.git', 'forge-rebase')))

  // ---- 2. squash with the default combined message ----
  await waitFor(() => js("document.querySelectorAll('#view-git .gc').length === 4"), 8000)
  check('the dialog opens again', await openDialogFrom('add one'))
  const shaFour = shaOf('add four')
  await setAction(shaFour, 'squash')
  const combined = await js("document.querySelector('#rebase .rebase-msg')?.value ?? ''")
  check('squashing shows the combined message to edit', combined === 'add two (reworded)\n\nadd four', JSON.stringify(combined))
  await js("document.getElementById('rebase-start').click()")
  check('the commits are combined', !!(await waitFor(() => subjects() === 'add two (reworded)|add one|base', 20000)), subjects())
  check('...with both messages in the commit message', out('log', '-1', '--format=%B').trim() === 'add two (reworded)\n\nadd four', JSON.stringify(out('log', '-1', '--format=%B')))
  check('...and both files', fs.existsSync(path.join(root, 'two.txt')) && fs.existsSync(path.join(root, 'four.txt')))

  // ---- 3. invalid plans are refused in the dialog ----
  await waitFor(() => js("document.querySelectorAll('#view-git .gc').length === 3"), 8000)
  check('the dialog opens a third time', await openDialogFrom('add one'))
  const rows3 = await js("[...document.querySelectorAll('#rebase .rebase-row')].map(r => r.dataset.sha).join(',')")
  const first = rows3.split(',')[0]
  check('the first commit cannot be squashed (nothing above it)', await js(`${dialogRow(first)}.querySelector('.rebase-action option[value=squash]').disabled`))
  await setAction(first, 'drop')
  const second = rows3.split(',')[1]
  await setAction(second, 'drop')
  check('dropping everything disables Start and says why', !!(await waitFor(async () => (await js("document.getElementById('rebase-start').disabled")) && /nothing would be left/.test(await js("document.getElementById('rebase-problem').textContent")), 3000)), await js("document.getElementById('rebase-problem').textContent"))
  await js("document.getElementById('rebase-cancel').click()")
  check('Cancel changes nothing', subjects() === 'add two (reworded)|add one|base' && out('status', '--porcelain').trim() === '')

  // ---- 4. conflicts: the todo list survives the stop ----
  write('c.txt', 'c base\n')
  commit('add c')
  write('c.txt', 'c from x\n')
  commit('x changes c')
  write('c.txt', 'c from y\n')
  commit('y changes c')
  check('the Git window shows the new commits', !!(await waitFor(() => js(`!!(${rowOf('x changes c')})`), 10000)), await js("[...document.querySelectorAll('#view-git .gc .gcsub')].map(r => r.textContent).join('|')"))
  check('the dialog opens for the conflict case', await openDialogFrom('x changes c'))
  const shaX = shaOf('x changes c')
  const shaY = shaOf('y changes c')
  await js(`${dialogRow(shaY)}.querySelector('.rebase-up').click()`) // y before x: both will conflict
  await sleep(150)
  await setAction(shaX, 'reword')
  await js("(() => { const a = document.querySelector('#rebase .rebase-msg'); a.value = 'x changes c (reworded)'; a.dispatchEvent(new Event('input')) })()")
  await js("document.getElementById('rebase-start').click()")
  check('the rebase stops on conflicts and says so', !!(await waitFor(async () => /conflict/i.test(await js("document.getElementById('log').textContent")) && fs.existsSync(path.join(root, '.git', 'rebase-merge')), 20000)))
  // Resolve each stop by hand, as a user would, and continue with plain git: the reword is in the persisted todo list.
  for (let i = 0; i < 4 && fs.existsSync(path.join(root, '.git', 'rebase-merge')); i++) {
    write('c.txt', `resolved ${i}\n`)
    git('add', 'c.txt')
    spawnSync('git', ['-c', 'core.editor=true', 'rebase', '--continue'], { cwd: root, encoding: 'utf8' })
  }
  check('after resolving, the rebase finishes', !fs.existsSync(path.join(root, '.git', 'rebase-merge')), subjects())
  check('...and the reword from before the stop was applied', out('log', '-1', '--format=%s').trim() === 'x changes c (reworded)', subjects())
})
