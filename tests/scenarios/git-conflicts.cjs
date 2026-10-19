// @ts-check
// Resolving a merge conflict: the file shows up in the Commit window, opens with its blocks highlighted and
// "Accept Yours / Theirs / Both" lenses, accepting a side edits the text, "Mark as Resolved" stages it, and the
// Commit button completes the merge.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('git-conflicts', { 'a.txt': 'line1\nshared\nline3\n', 'b.txt': 'b one\nb shared\nb three\n' }, async (t) => {
  const { js, key, check, sleep, waitFor, root, wc } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const git = (/** @type {string[]} */ ...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  const gitq = (/** @type {string[]} */ ...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    return r.status === 0 ? r.stdout.trim() : ''
  }
  const read = (/** @type {string} */ name) => fs.readFileSync(path.join(root, name), 'utf8')
  const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('\\n')")
  const lens = (/** @type {string} */ title) =>
    `[...document.querySelectorAll('#editor .codelens-decoration a')].find(a => a.textContent.startsWith(${JSON.stringify(title)}))`

  /** A real mouse click on an element (code lenses listen for mouse events, not for a synthetic click()). */
  const mouseClick = async (/** @type {string} */ elementExpr) => {
    const box = await js(`(() => { const r = (${elementExpr}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    wc.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y })
    wc.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  }

  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Forge Test')
  git('config', 'user.email', 'test@example.com')
  git('config', 'core.autocrlf', 'false')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  git('switch', '-q', '-c', 'other')
  fs.writeFileSync(path.join(root, 'a.txt'), 'line1\ntheirs version\nline3\n')
  fs.writeFileSync(path.join(root, 'b.txt'), 'b one\nb theirs\nb three\n')
  git('commit', '-q', '-am', 'other change')
  git('switch', '-q', 'main')
  fs.writeFileSync(path.join(root, 'a.txt'), 'line1\nyours version\nline3\n')
  fs.writeFileSync(path.join(root, 'b.txt'), 'b one\nb yours\nb three\n')
  git('commit', '-q', '-am', 'main change')
  spawnSync('git', ['merge', 'other'], { cwd: root, encoding: 'utf8' }) // stops on conflicts in both files

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  key('0', ['alt'])
  check('both conflicted files are listed in the Commit window', !!(await waitFor(async () => (await js("document.querySelectorAll('#commit-list .change .badge.conflict').length")) === 2, 6000)), await text('commit-list'))
  check('the button says it will complete the merge, but waits for the conflicts to be resolved', (await text('commit-btn')) === 'Complete merge' && (await js("document.getElementById('commit-btn').disabled")))

  // ---- a.txt: accept a side from the editor ----
  await js("[...document.querySelectorAll('#commit-list .change')].find(r => r.textContent.includes('a.txt')).click()")
  check('clicking a conflicted file opens it in the editor', !!(await waitFor(async () => (await text('tabs')).includes('a.txt') && !(await text('tabs')).includes('(diff)'), 4000)), await text('tabs'))
  check('...with its blocks highlighted', !!(await waitFor(() => js("document.querySelector('#editor .conflict-yours-line') && document.querySelector('#editor .conflict-theirs-line') ? true : false"), 4000)))
  check('...and a lens for each choice', !!(await waitFor(async () => (await js(`!!${lens('Accept Theirs')}`)) && (await js(`!!${lens('Accept Yours')}`)) && (await js(`!!${lens('Accept Both')}`)), 8000)))
  await mouseClick(lens('Accept Theirs'))
  check('Accept Theirs replaces the block with their side', !!(await waitFor(async () => {
    const e = await editorText()
    return e.includes('theirs version') && !e.includes('<<<<<<<') && !e.includes('yours version')
  }, 4000)), await editorText())
  key('S', ['control'])
  await waitFor(() => read('a.txt') === 'line1\ntheirs version\nline3\n', 4000)
  check('saving writes the resolved text', read('a.txt') === 'line1\ntheirs version\nline3\n', read('a.txt'))
  await js("[...document.querySelectorAll('#commit-list .change')].find(r => r.textContent.includes('a.txt')).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }))")
  await sleep(250)
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === 'Mark as Resolved').click()")
  check('Mark as Resolved stages the file', !!(await waitFor(() => !gitq('diff', '--name-only', '--diff-filter=U').includes('a.txt'), 5000)))

  // ---- b.txt: take a whole side from the Commit window ----
  await waitFor(async () => (await js("document.querySelectorAll('#commit-list .change .badge.conflict').length")) === 1, 5000)
  await js("[...document.querySelectorAll('#commit-list .change')].find(r => r.textContent.includes('b.txt')).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }))")
  await sleep(250)
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.startsWith('Accept Ours')).click()")
  check('Accept Ours (whole file) takes our version and resolves it', !!(await waitFor(() => gitq('diff', '--name-only', '--diff-filter=U') === '' && read('b.txt').includes('b yours'), 5000)), read('b.txt'))

  // ---- complete the merge ----
  check('with nothing left in conflict the button is enabled', !!(await waitFor(async () => !(await js("document.getElementById('commit-btn').disabled")), 5000)))
  await js("document.getElementById('commit-btn').click()")
  check('Complete merge makes the merge commit', !!(await waitFor(() => !fs.existsSync(path.join(root, '.git', 'MERGE_HEAD')) && gitq('log', '-1', '--format=%p').split(' ').length === 2, 8000)), gitq('log', '-1', '--format=%s'))
  check('...and the button goes back to Commit', !!(await waitFor(async () => (await text('commit-btn')) === 'Commit', 5000)))
})
