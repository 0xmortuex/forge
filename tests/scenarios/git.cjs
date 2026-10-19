// @ts-check
// Git: branch widget, tree colors, Commit window, diff tab, blame, partial commit, branch create/switch.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('git', { 'a.txt': 'one\ntwo\n', 'src/b.ts': 'export const b = 1\n' }, async (t) => {
  const { js, key, waitFor, check, root, sleep } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const git = (/** @type {string[]} */ ...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }

  // Repo with one commit, then one modified and one untracked file.
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Forge Test')
  git('config', 'user.email', 'test@example.com')
  git('config', 'core.autocrlf', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'initial')
  require('node:fs').writeFileSync(path.join(root, 'a.txt'), 'one\nTWO\n')
  require('node:fs').writeFileSync(path.join(root, 'c.txt'), 'new file\n')

  const node = (/** @type {string} */ name) =>
    `[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)})`

  key('O', ['control'])
  check('branch widget shows the current branch', !!(await waitFor(async () => (await text('branch-name')) === 'main', 8000)))
  check(
    'tree colors a modified and an untracked file',
    !!(await waitFor(
      () => js(`${node('a.txt')}?.dataset.git === 'modified' && ${node('c.txt')}?.dataset.git === 'untracked'`),
      8000
    ))
  )

  // Commit window
  key('0', ['alt'])
  check('Alt+0 opens the Commit window', !!(await waitFor(() => js("!document.getElementById('commit-view').hidden"), 3000)))
  check(
    'Commit window lists both changes',
    !!(await waitFor(async () => (await text('commit-summary')) === '2 changes', 5000)),
    await text('commit-summary')
  )

  // Diff tab: HEAD on the left, working copy on the right
  await js("[...document.querySelectorAll('.change')].find(r => r.textContent.includes('a.txt')).click()")
  check('clicking a change opens a diff tab', !!(await waitFor(async () => (await text('tabs')).includes('a.txt (diff)'), 5000)))
  check(
    'diff shows old and new text side by side',
    !!(await waitFor(async () => {
      const d = await text('diff')
      return d.includes('two') && d.includes('TWO')
    }, 8000))
  )

  await t.shot('git-diff.png')

  // The right side is the real file: edit it inside the diff, save, and close in either order.
  await t.type('EDIT-')
  check('typing in the diff marks its tab dirty', !!(await waitFor(() => js("!!document.querySelector('.tab .dot')"), 3000)))
  check(
    'the diff updates live with the edit',
    !!(await waitFor(async () => (await text('diff')).includes('EDIT-one'), 5000))
  )
  key('S', ['control'])
  check(
    'Ctrl+S in the diff saves the real file',
    !!(await waitFor(() => require('node:fs').readFileSync(path.join(root, 'a.txt'), 'utf8').startsWith('EDIT-one'), 5000))
  )
  check('the dirty marker clears after saving', !!(await waitFor(() => js("!document.querySelector('.tab .dot')"), 3000)))
  await js(
    "[...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('a.txt') && !t.textContent.includes('(diff)')).querySelector('.close').click()"
  )
  check(
    'closing the file tab also closes the diff that edits it',
    !!(await waitFor(async () => !(await text('tabs')).includes('a.txt'), 3000)),
    await text('tabs')
  )

  // Blame: committed line, then an uncommitted line
  await js("document.querySelector('.btab[data-win=\"project\"]').click()")
  await js(`${node('src')}.click()`) // expand the folder; its children render lazily
  await waitFor(() => js(`!!${node('b.ts')}`), 5000)
  await js(`${node('b.ts')}.click()`)
  check(
    'blame shows the author of a committed line',
    !!(await waitFor(async () => (await text('st-blame')).startsWith('Blame: Forge Test'), 8000)),
    await text('st-blame')
  )
  await js(`${node('a.txt')}.click()`)
  await sleep(500)
  key('Home', ['control'])
  key('Down')
  check(
    'blame says "Not committed yet" for a changed line',
    !!(await waitFor(async () => (await text('st-blame')) === 'Not committed yet', 8000)),
    await text('st-blame')
  )

  // Partial commit through the UI: commit a.txt only, leave c.txt out.
  key('0', ['alt']) // toggles: Commit window was left, so this shows it again
  await waitFor(() => js("!document.getElementById('commit-view').hidden"), 3000)
  await js("[...document.querySelectorAll('.change')].find(r => r.textContent.includes('c.txt')).querySelector('input').click()")
  await js("document.getElementById('commit-msg').value = 'Edit a.txt'; undefined")
  await js("document.getElementById('commit-btn').click()")
  check(
    'commit lands in the repository with the message',
    !!(await waitFor(() => git('log', '-1', '--format=%s') === 'Edit a.txt', 8000))
  )
  check('the unchecked file was left out of the commit', git('status', '--porcelain') === '?? c.txt')
  check(
    'Commit window now lists only the remaining change',
    !!(await waitFor(async () => (await text('commit-summary')) === '1 change', 5000)),
    await text('commit-summary')
  )
  check('diff tabs are closed after a commit', !(await text('tabs')).includes('(diff)'))

  // Branches
  const menuClick = (/** @type {string} */ label) =>
    js(`[...document.querySelectorAll('.ctx-item')].find(i => i.textContent.includes(${JSON.stringify(label)})).click()`)
  await js("document.getElementById('branch-widget').click()")
  await waitFor(() => js("document.querySelectorAll('.ctx-item').length > 0"), 3000)
  await menuClick('New Branch')
  await sleep(200)
  await js("(() => { const i = document.getElementById('ask-input'); i.value = 'feature'; document.getElementById('ask-box').requestSubmit() })()")
  check(
    'New Branch creates and switches to it',
    !!(await waitFor(() => git('branch', '--show-current') === 'feature', 8000)) &&
      !!(await waitFor(async () => (await text('branch-name')) === 'feature', 5000))
  )
  await js("document.getElementById('branch-widget').click()")
  await waitFor(() => js("document.querySelectorAll('.ctx-item').length > 0"), 3000)
  await menuClick('main')
  check('picking a branch from the menu switches to it', !!(await waitFor(() => git('branch', '--show-current') === 'main', 8000)))
})
