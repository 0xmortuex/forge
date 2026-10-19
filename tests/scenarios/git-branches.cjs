// @ts-check
// The Branches popup: switching, remote branches, merge, rebase, rename, delete, compare with the working tree, and a
// merge that stops on conflicts being finished with Continue.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('git-branches', { 'a.txt': 'base\n' }, async (t) => {
  const { js, key, type, enter, check, sleep, waitFor, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  /** @param {string} cwd @param {string[]} args */
  const gitIn = (cwd, args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  const git = (/** @type {string[]} */ ...args) => gitIn(root, args)
  const gitq = (/** @type {string[]} */ ...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    return r.status === 0 ? r.stdout.trim() : ''
  }
  const write = (/** @type {string} */ name, /** @type {string} */ body) => fs.writeFileSync(path.join(root, name), body)
  const commit = (/** @type {string} */ msg) => {
    git('add', '-A')
    git('commit', '-q', '-m', msg)
  }
  const quickRows = () => js("[...document.querySelectorAll('#quick-results .result')].map(r => r.textContent).join('|')")
  const openBranches = async () => {
    await js("document.getElementById('branch-widget').click()")
    await waitFor(() => js("!document.getElementById('quick').hidden"), 3000)
    await sleep(200)
  }
  /** Right-clicks a branch in the popup and picks an entry of its menu. */
  const branchAction = async (/** @type {string} */ branch, /** @type {string} */ label) => {
    await openBranches()
    await type(branch)
    await sleep(250)
    await js("document.querySelector('#quick-results .result.sel').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))")
    await sleep(250)
    await js(`[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.includes(${JSON.stringify(label)})).click()`)
    await sleep(500)
  }

  // ---- a repository with a remote ----
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-remote-'))
  gitIn(remote, ['init', '-q', '--bare', '-b', 'main'])
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Forge Test')
  git('config', 'user.email', 'test@example.com')
  git('config', 'core.autocrlf', 'false')
  git('config', 'commit.gpgsign', 'false')
  commit('base')
  git('remote', 'add', 'origin', remote)
  git('push', '-q', '-u', 'origin', 'main')
  git('switch', '-q', '-c', 'dev')
  write('d.txt', 'from dev\n')
  commit('dev work')
  git('push', '-q', '-u', 'origin', 'dev')
  git('switch', '-q', 'main')
  git('branch', 'old') // fully merged: deleting it needs no force
  git('switch', '-q', '-c', 'wip')
  write('w.txt', 'unmerged\n')
  commit('wip work') // not merged anywhere
  git('switch', '-q', 'main')
  git('fetch', '-q', 'origin')

  key('O', ['control'])
  await waitFor(async () => (await text('branch-name')) === 'main', 8000)

  // ---- the popup ----
  await openBranches()
  const rows = await quickRows()
  check('the popup lists New Branch and Fetch first', rows.indexOf('New Branch…') >= 0 && rows.indexOf('New Branch…') < rows.indexOf('Fetch') && rows.indexOf('Fetch') < rows.indexOf('main'), rows)
  check('...then the current branch, local branches and remote ones', rows.includes('main') && rows.includes('dev') && rows.includes('origin/dev'), rows)
  check('the current branch is marked', rows.includes('current'), rows)
  key('Escape')

  // ---- merge ----
  await branchAction('dev', 'Merge')
  check('Merge brings the other branch\'s work into the current one', !!(await waitFor(() => fs.existsSync(path.join(root, 'd.txt')) && gitq('log', '-1', '--format=%s') !== 'base', 6000)), gitq('log', '-1', '--format=%s'))

  // ---- rename ----
  await branchAction('dev', 'Rename')
  await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
  await js("document.getElementById('ask-input').select(); undefined")
  await type('dev2')
  enter()
  check('Rename renames the local branch', !!(await waitFor(() => gitq('branch', '--list', 'dev2') !== '' && gitq('branch', '--list', 'dev') === '', 5000)))

  // ---- delete ----
  await branchAction('old', 'Delete')
  check('Delete removes a merged branch', !!(await waitFor(() => gitq('branch', '--list', 'old') === '', 5000)))
  await branchAction('wip', 'Delete')
  check('...and asks before removing one with unmerged work, then does', !!(await waitFor(() => gitq('branch', '--list', 'wip') === '', 5000)))

  // ---- remote branch ----
  await branchAction('origin/dev', 'Checkout')
  check(
    'Checkout on a remote branch makes a local one that tracks it',
    !!(await waitFor(() => gitq('branch', '--show-current') === 'dev' && gitq('rev-parse', '--abbrev-ref', 'dev@{upstream}') === 'origin/dev', 6000)),
    gitq('branch', '--show-current')
  )
  await waitFor(async () => (await text('branch-name')) === 'dev', 5000)

  // ---- compare with the working tree ----
  git('switch', '-q', 'main')
  await waitFor(async () => (await text('branch-name')) === 'main', 5000)
  write('a.txt', 'changed in the working tree\n')
  await branchAction('dev2', 'Compare with Working Tree')
  check('Compare lists what differs from that branch', !!(await waitFor(async () => (await js("!document.getElementById('quick').hidden")) && (await quickRows()).includes('a.txt'), 4000)), await quickRows())
  await type('a.txt')
  await sleep(200)
  key('Enter')
  check('...and choosing a file opens its diff', !!(await waitFor(async () => (await text('tabs')).includes('(diff)'), 5000)), await text('tabs'))
  git('checkout', '--', 'a.txt')

  // ---- rebase ----
  git('switch', '-q', '-c', 'feature')
  write('f.txt', 'feature\n')
  commit('feature work')
  git('switch', '-q', 'main')
  write('m.txt', 'main moved\n')
  commit('main moved on')
  git('switch', '-q', 'feature')
  await waitFor(async () => (await text('branch-name')) === 'feature', 5000)
  await branchAction('main', 'Rebase')
  check('Rebase replays the current branch on top of the other', !!(await waitFor(() => spawnSync('git', ['merge-base', '--is-ancestor', 'main', 'feature'], { cwd: root }).status === 0 && gitq('log', '-1', '--format=%s') === 'feature work', 8000)))

  // ---- a merge that stops on conflicts, resolved, then Continue ----
  git('switch', '-q', 'main')
  git('switch', '-q', '-c', 'left')
  write('c.txt', 'left\n')
  commit('left')
  git('switch', '-q', 'main')
  git('switch', '-q', '-c', 'right')
  write('c.txt', 'right\n')
  commit('right')
  await waitFor(async () => (await text('branch-name')) === 'right', 5000)
  await branchAction('left', 'Merge')
  check('a conflicting merge stops and leaves the repository mid-merge', !!(await waitFor(() => fs.existsSync(path.join(root, '.git', 'MERGE_HEAD')), 6000)))
  key('9', ['alt'])
  check('the Git window shows the merge banner', !!(await waitFor(async () => !(await js("document.querySelector('#view-git .git-banner').hidden")), 6000)))
  write('c.txt', 'resolved\n')
  git('add', 'c.txt')
  await js("[...document.querySelectorAll('#view-git .git-banner button')].find(b => b.textContent === 'Continue').click()")
  check('Continue finishes the merge', !!(await waitFor(() => !fs.existsSync(path.join(root, '.git', 'MERGE_HEAD')) && gitq('log', '-1', '--format=%p').split(' ').length === 2, 8000)), gitq('log', '-1', '--format=%s'))
  check('...and the banner goes away', !!(await waitFor(() => js("document.querySelector('#view-git .git-banner').hidden"), 5000)))
  fs.rmSync(remote, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})
