// @ts-check
// Everyday git details: ignored files dimmed in the tree, Add to .gitignore, Amend, Commit & Push, the pull strategy,
// force push, and applying a stash while keeping it.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('git-extras', { 'a.txt': 'one\n', 'ignored.txt': 'x\n', 'build/out.js': '//\n', '.gitignore': 'ignored.txt\nbuild/\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor, root } = t
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
  const node = (/** @type {string} */ name) => `[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)})`
  const write = (/** @type {string} */ name, /** @type {string} */ body) => fs.writeFileSync(path.join(root, name), body)
  const logText = () => text('log')

  // ---- a repository with a remote and a teammate's clone ----
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-extras-'))
  const remote = path.join(base, 'remote.git')
  const mate = path.join(base, 'mate')
  gitIn(base, ['init', '-q', '--bare', '-b', 'main', remote])
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Forge Test')
  git('config', 'user.email', 'test@example.com')
  git('config', 'core.autocrlf', 'false')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'first')
  git('remote', 'add', 'origin', remote)
  git('push', '-q', '-u', 'origin', 'main')
  gitIn(base, ['clone', '-q', '-c', 'core.autocrlf=false', remote, mate])
  gitIn(mate, ['config', 'user.name', 'Mate'])
  gitIn(mate, ['config', 'user.email', 'mate@example.com'])
  gitIn(mate, ['config', 'commit.gpgsign', 'false'])

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  key('0', ['alt'])

  // ---- ignored files ----
  check('an ignored file is dimmed in the tree', !!(await waitFor(() => js(`${node('ignored.txt')}?.dataset.git === 'ignored'`), 6000)))
  check('...and so is an ignored folder', (await js(`${node('build')}?.dataset.git`)) === 'ignored')
  check('while a normal file is not', (await js(`${node('a.txt')}?.dataset.git ?? ''`)) === '')

  // ---- Add to .gitignore ----
  write('junk.txt', 'junk\n')
  await js("document.getElementById('commit-refresh').click()")
  await waitFor(() => js("[...document.querySelectorAll('#commit-list .change')].some(r => r.textContent.includes('junk.txt'))"), 5000)
  await js("[...document.querySelectorAll('#commit-list .change')].find(r => r.textContent.includes('junk.txt')).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }))")
  await sleep(250)
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === 'Add to .gitignore').click()")
  check('Add to .gitignore appends the path', !!(await waitFor(() => fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('/junk.txt'), 5000)))
  check('...and the file is now dimmed', !!(await waitFor(() => js(`${node('junk.txt')}?.dataset.git === 'ignored'`), 6000)))
  git('checkout', '--', '.gitignore') // back to the committed one, so the next commits are only about a.txt

  // ---- Amend ----
  write('a.txt', 'one\ntwo\n')
  await js("document.getElementById('commit-refresh').click()")
  await waitFor(() => js("[...document.querySelectorAll('#commit-list .change')].some(r => r.textContent.includes('a.txt'))"), 5000)
  await js("document.getElementById('commit-amend').click()")
  check('ticking Amend fills in the previous message', !!(await waitFor(async () => (await js("document.getElementById('commit-msg').value")) === 'first', 4000)))
  await js("document.getElementById('commit-btn').click()")
  check('Commit with Amend rewrites the last commit instead of adding one', !!(await waitFor(() => gitq('rev-list', '--count', 'HEAD') === '1' && gitq('show', 'HEAD:a.txt') === 'one\ntwo', 6000)), gitq('rev-list', '--count', 'HEAD'))

  // ---- force push after rewriting a pushed commit ----
  await js("document.getElementById('commit-push').click()")
  check('a normal push is rejected after the history was rewritten', !!(await waitFor(async () => /rejected|non-fast-forward|fetch first/i.test(await logText()), 8000)), (await logText()).slice(-300))
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await type('force push')
  await sleep(300)
  key('Enter')
  check('Force Push (with lease) overwrites the remote branch', !!(await waitFor(() => gitIn(base, ['--git-dir', remote, 'rev-parse', 'main']) === gitq('rev-parse', 'HEAD'), 8000)))

  // ---- Commit & Push ----
  write('a.txt', 'one\ntwo\nthree\n')
  await js("document.getElementById('commit-refresh').click()")
  await waitFor(() => js("[...document.querySelectorAll('#commit-list .change')].some(r => r.textContent.includes('a.txt'))"), 5000)
  await js("(() => { const m = document.getElementById('commit-msg'); m.value = 'push me'; m.dispatchEvent(new Event('input')) })()")
  await js("document.getElementById('commit-push-btn').click()")
  check('Commit & Push commits and pushes in one go', !!(await waitFor(() => gitIn(base, ['--git-dir', remote, 'log', '-1', '--format=%s', 'main']) === 'push me', 10000)))

  // ---- the pull strategy ----
  // The teammate first catches up with what was pushed (and force-pushed) so far, then adds a commit of their own.
  gitIn(mate, ['fetch', '-q', 'origin'])
  gitIn(mate, ['reset', '-q', '--hard', 'origin/main'])
  fs.writeFileSync(path.join(mate, 'm.txt'), 'mate\n') // in the teammate's clone, not ours
  gitIn(mate, ['add', '-A'])
  gitIn(mate, ['commit', '-q', '-m', 'mate work'])
  gitIn(mate, ['push', '-q', 'origin', 'main'])
  write('local.txt', 'local\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'local work')
  await js("document.getElementById('commit-pull').click()")
  check('Pull with the default strategy refuses to merge behind your back', !!(await waitFor(async () => /fast-forward|diverging|Not possible/i.test(await logText()), 10000)), (await logText()).slice(-300))
  key(',', ['control'])
  await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
  await js("document.querySelector('.snav[data-cat=\"Editor\"]').click()")
  await sleep(400)
  await js(`(() => { const s = [...document.querySelectorAll('.srow')].find(r => r.querySelector('.label')?.textContent === 'Pull strategy').querySelector('select'); s.value = 'merge'; s.dispatchEvent(new Event('change')) })()`)
  await sleep(300)
  await js("document.getElementById('settings-close').click()")
  await js("document.getElementById('commit-pull').click()")
  check('with "Merge" chosen, Pull merges the remote commits in', !!(await waitFor(() => gitq('log', '-1', '--format=%p').split(' ').length === 2 && fs.existsSync(path.join(root, 'm.txt')), 10000)), gitq('log', '-1', '--format=%s'))

  // ---- stash apply keeps the stash ----
  write('a.txt', 'one\ntwo\nthree\nstashed change\n')
  git('stash', 'push', '-q', '-m', 'my stash')
  await waitFor(() => !fs.readFileSync(path.join(root, 'a.txt'), 'utf8').includes('stashed'), 3000)
  await js("document.getElementById('commit-stash').click()")
  await waitFor(() => js("[...document.querySelectorAll('#ctx .ctx-item')].some(i => i.textContent.startsWith('Apply:'))"), 4000)
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.startsWith('Apply:')).click()")
  check('Apply brings the stashed change back', !!(await waitFor(() => fs.readFileSync(path.join(root, 'a.txt'), 'utf8').includes('stashed change'), 5000)))
  check('...and leaves it in the stash list', gitq('stash', 'list').includes('my stash'), gitq('stash', 'list'))
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
})
