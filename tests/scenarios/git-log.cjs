// @ts-check
// The Git window: commit history with a graph, filters, commit details and diffs, file history, operations from the
// commit menu (cherry-pick, revert, new branch, tag, reset) and the banner for a merge that stopped on conflicts.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('git-log', { 'a.txt': 'one\n' }, async (t) => {
  const { js, key, type, enter, check, sleep, waitFor, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const git = (/** @type {string[]} */ ...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  // For polling: a ref that doesn't exist yet is a "not yet", not an error.
  const gitq = (/** @type {string[]} */ ...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    return r.status === 0 ? r.stdout.trim() : ''
  }
  const write = (/** @type {string} */ name, /** @type {string} */ body) => fs.writeFileSync(path.join(root, name), body)
  const commit = (/** @type {string} */ msg) => {
    git('add', '-A')
    git('commit', '-q', '-m', msg)
  }
  const rows = () => js("document.querySelectorAll('#view-git .gc').length")
  const subjects = () => js("[...document.querySelectorAll('#view-git .gc .gcsub')].map(r => r.textContent).join('|')")
  const rowOf = (/** @type {string} */ subject) => `[...document.querySelectorAll('#view-git .gc')].find(r => r.querySelector('.gcsub').textContent === ${JSON.stringify(subject)})`
  const menu = async (/** @type {string} */ subject, /** @type {string} */ label) => {
    await js(`${rowOf(subject)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))`)
    await sleep(250)
    await js(`[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.startsWith(${JSON.stringify(label)})).click()`)
    await sleep(400)
  }
  const setSelect = (/** @type {string} */ value) =>
    js(`(() => { const s = document.querySelector('#view-git .git-branch'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')) })()`)
  const setInput = (/** @type {string} */ selector, /** @type {string} */ value) =>
    js(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input')) })()`)

  // ---- a small history with a branch and a merge ----
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Forge Test')
  git('config', 'user.email', 'test@example.com')
  git('config', 'core.autocrlf', 'false')
  git('config', 'commit.gpgsign', 'false')
  commit('c1 first')
  write('b.txt', 'two\n')
  commit('c2 second')
  const c2 = git('rev-parse', 'HEAD')
  git('switch', '-q', '-c', 'topic')
  write('t.txt', 'topic\n')
  commit('t1 topic fix')
  git('switch', '-q', 'main')
  git('switch', '-q', '-c', 'feature')
  write('feat.txt', 'feature\n')
  commit('f1 feature work')
  git('switch', '-q', 'main')
  write('m.txt', 'main\n')
  commit('m1 main work')
  git('merge', '-q', '--no-ff', 'feature', '-m', 'merge feature')

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)

  key('9', ['alt'])
  check('Alt+9 opens the Git window', !!(await waitFor(async () => !(await js("document.getElementById('view-git').hidden")), 3000)))
  check('it lists the current branch\'s commits, newest first', !!(await waitFor(async () => (await subjects()) === 'merge feature|m1 main work|f1 feature work|c2 second|c1 first', 8000)), await subjects())
  check('the newest commit carries the branch badge', (await js("document.querySelector('#view-git .gc .ref.head')?.textContent")) === 'main')
  check('every row has a graph cell', (await js("document.querySelectorAll('#view-git .gc .gcg svg circle').length")) === 5)
  check('the merge has a line to its second parent', (await js("document.querySelectorAll('#view-git .gc')[0].querySelectorAll('svg path').length")) >= 1)

  // ---- details and diffs ----
  await js(`${rowOf('merge feature')}.click()`)
  check('selecting a commit shows its details', !!(await waitFor(async () => (await text('view-git')).includes('Forge Test') && (await js("document.querySelector('#view-git .gd-subject')?.textContent")) === 'merge feature', 4000)))
  check('a merge lists what it changed against its first parent', !!(await waitFor(async () => (await js("[...document.querySelectorAll('#view-git .gf .name')].map(n => n.textContent).join(',')")) === 'feat.txt', 4000)), await js("[...document.querySelectorAll('#view-git .gf .name')].map(n => n.textContent).join(',')"))
  await js(`${rowOf('c2 second')}.click()`)
  await waitFor(async () => (await js("[...document.querySelectorAll('#view-git .gf .name')].map(n => n.textContent).join(',')")) === 'b.txt', 4000)
  await js("document.querySelector('#view-git .gf').click()")
  check('clicking a file opens a read-only diff of that commit', !!(await waitFor(async () => (await text('tabs')).includes('b.txt @') && (await text('tabs')).includes('(diff)'), 4000)), await text('tabs'))
  check(
    '...with the file as it became on the right',
    !!(await waitFor(async () => (await js("document.querySelector('#diff .editor.modified .view-lines')?.textContent ?? ''")).includes('two'), 4000))
  )

  // ---- filters ----
  await setInput('#view-git .git-filter[placeholder="Message"]', 'f1')
  check('the message filter narrows the list', !!(await waitFor(async () => (await rows()) === 1, 4000)), await subjects())
  check('...and drops the graph, which only makes sense for the whole history', (await js("document.querySelectorAll('#view-git .gcg').length")) === 0)
  await setInput('#view-git .git-filter[placeholder="Message"]', '')
  await waitFor(async () => (await rows()) === 5, 4000)
  await setSelect('all')
  check('"All branches" includes the other branches', !!(await waitFor(async () => (await subjects()).includes('t1 topic fix') && (await rows()) === 6, 4000)), await subjects())

  // ---- operations from the commit menu ----
  await setSelect('')
  await waitFor(async () => (await rows()) === 5, 4000)
  await setSelect('all')
  await waitFor(async () => (await rows()) === 6, 4000)
  await menu('t1 topic fix', 'Cherry-Pick')
  check('Cherry-Pick applies the commit to the current branch', !!(await waitFor(() => git('log', '-1', '--format=%s') === 't1 topic fix' && git('branch', '--show-current') === 'main', 5000)), git('log', '-1', '--format=%s'))
  await menu('m1 main work', 'Revert Commit')
  check('Revert Commit adds a revert commit', !!(await waitFor(() => git('log', '-1', '--format=%s').startsWith('Revert "m1 main work"'), 5000)), git('log', '-1', '--format=%s'))

  await menu('c2 second', 'New Tag')
  await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
  await type('v-test')
  enter()
  check('New Tag tags that commit', !!(await waitFor(() => gitq('rev-parse', 'v-test^{commit}') === c2, 4000)))

  await menu('c1 first', 'New Branch from Here')
  await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
  await type('from-c1')
  enter()
  check('New Branch from Here creates and switches to it', !!(await waitFor(() => git('branch', '--show-current') === 'from-c1', 5000)), git('branch', '--show-current'))
  await waitFor(async () => (await js("document.querySelector('#view-git .gc .ref.head')?.textContent")) === 'from-c1', 5000)

  await menu('c2 second', 'Reset Current Branch to Here (mixed)')
  check('Reset moves the branch to that commit', !!(await waitFor(() => git('rev-parse', 'HEAD') === c2, 5000)), git('rev-parse', 'HEAD'))

  // ---- file history ----
  await setSelect('')
  await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'a.txt').click()")
  await waitFor(async () => (await text('tabs')).includes('a.txt'), 3000)
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await type('git history for file')
  await sleep(300)
  key('Enter')
  check('Show Git History for File lists only the commits that touched it', !!(await waitFor(async () => (await rows()) === 1 && (await subjects()) === 'c1 first', 5000)), await subjects())
  check('...with a chip to go back to the whole history', (await text('view-git')).includes('History of a.txt'))
  await js("document.querySelector('#view-git .git-pathchip').click()")
  check('clicking the chip shows everything again', !!(await waitFor(async () => (await rows()) >= 2, 4000)))

  // ---- a merge that stops on conflicts ----
  git('switch', '-q', 'main')
  git('switch', '-q', '-c', 'left')
  write('a.txt', 'left side\n')
  commit('left change')
  git('switch', '-q', 'main')
  git('switch', '-q', '-c', 'right')
  write('a.txt', 'right side\n')
  commit('right change')
  spawnSync('git', ['merge', 'left'], { cwd: root, encoding: 'utf8' }) // conflicts: exits 1, leaving the merge in progress
  await js("document.querySelector('#view-git .git-branch').dispatchEvent(new Event('change'))")
  check('a merge stopped on conflicts shows a banner with Continue and Abort', !!(await waitFor(async () => !(await js("document.querySelector('#view-git .git-banner').hidden")) && (await text('view-git')).includes('merge is in progress'), 5000)))
  await js("[...document.querySelectorAll('#view-git .git-banner button')].find(b => b.textContent === 'Abort').click()")
  check('Abort puts everything back', !!(await waitFor(() => !fs.existsSync(path.join(root, '.git', 'MERGE_HEAD')) && git('status', '--porcelain') === '', 5000)), git('status', '--porcelain'))
  check('...and the banner goes away', !!(await waitFor(() => js("document.querySelector('#view-git .git-banner').hidden"), 4000)))
})
