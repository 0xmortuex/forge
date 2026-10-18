// @ts-check
// Git remotes: ahead/behind, push, pull (ff-only), diverged pull error, stash/pop, revert/delete, publish branch.
// Uses a local bare repository as "origin" and a second clone as a teammate — no network.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { run } = require('../harness.cjs')

/** @param {string} cwd @param {string[]} args */
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} (in ${cwd}): ${r.stderr}`)
  return r.stdout.trim()
}

run('git-remote', { 'a.txt': 'one\ntwo\n' }, async (t) => {
  const { js, key, waitFor, check, root, sleep } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-origin-'))
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-mate-'))
  try {
    const identity = (/** @type {string} */ dir) => {
      git(dir, 'config', 'user.name', 'Forge Test')
      git(dir, 'config', 'user.email', 'test@example.com')
      git(dir, 'config', 'core.autocrlf', 'false')
    }
    git(bare, 'init', '-q', '--bare', '-b', 'main')
    git(root, 'init', '-q', '-b', 'main')
    identity(root)
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'initial')
    git(root, 'remote', 'add', 'origin', bare)
    git(root, 'push', '-q', '-u', 'origin', 'main')
    // autocrlf must be off *during* the clone, or Windows checks files out with CRLF and they look modified.
    git(os.tmpdir(), 'clone', '-q', '-c', 'core.autocrlf=false', bare, other)
    identity(other)

    const click = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).click()`)
    const refresh = () => click('commit-refresh')
    const widget = () => text('branch-name')
    const menuClick = (/** @type {string} */ label) =>
      js(`[...document.querySelectorAll('.ctx-item')].find(i => i.textContent.includes(${JSON.stringify(label)})).click()`)
    const menuOpen = () => waitFor(() => js('document.querySelectorAll(".ctx-item").length > 0'), 3000)
    const ask = (/** @type {string} */ value) =>
      js(`(() => { const i = document.getElementById('ask-input'); i.value = ${JSON.stringify(value)}; document.getElementById('ask-box').requestSubmit() })()`)
    const rightClickChange = (/** @type {string} */ name) =>
      js(`[...document.querySelectorAll('.change')].find(r => r.textContent.includes(${JSON.stringify(name)})).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 120 }))`)
    /** The teammate always syncs first, like anyone would. */
    const mateSync = () => git(other, 'pull', '-q', '--ff-only')
    const write = (/** @type {string} */ dir, /** @type {string} */ file, /** @type {string} */ content) =>
      fs.writeFileSync(path.join(dir, file), content)

    key('O', ['control'])
    check('in sync with the remote: no arrows', !!(await waitFor(async () => (await widget()) === 'main', 8000)), await widget())
    key('0', ['alt'])

    // Ahead: a local commit shows ↑1, Push sends it
    write(root, 'a.txt', 'one\ntwo\nlocal\n')
    git(root, 'commit', '-q', '-am', 'local one')
    await refresh()
    check('a local commit shows ↑1', !!(await waitFor(async () => (await widget()) === 'main ↑1', 5000)), await widget())
    await click('commit-push')
    check('Push delivers the commit to the remote', !!(await waitFor(() => git(bare, 'log', '-1', '--format=%s', 'main') === 'local one', 15000)))
    check('the arrows clear after pushing', !!(await waitFor(async () => (await widget()) === 'main', 5000)), await widget())

    // Pull: a teammate's new file arrives
    mateSync()
    write(other, 'from-mate.txt', 'hello\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'mate adds a file')
    git(other, 'push', '-q')
    await click('commit-pull')
    check('Pull brings in the teammate\'s file', !!(await waitFor(() => fs.existsSync(path.join(root, 'from-mate.txt')), 15000)))
    key('1', ['alt'])
    check('the project tree shows it', !!(await waitFor(async () => (await text('tree')).includes('from-mate.txt'), 5000)))

    // Pull reloads a file that is open in the editor (and isn't modified)
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'a.txt').click()")
    await waitFor(async () => (await text('tabs')).includes('a.txt'), 5000)
    mateSync()
    write(other, 'a.txt', 'one\ntwo\nlocal\nTEAMMATE-LINE\n')
    git(other, 'commit', '-q', '-am', 'mate edits a.txt')
    git(other, 'push', '-q')
    await click('commit-pull')
    check(
      'an open, unmodified file is reloaded after a pull',
      !!(await waitFor(async () => (await text('editor')).includes('TEAMMATE-LINE'), 15000))
    )

    // Diverged history: the pull must fail loudly, never merge silently
    write(root, 'b.txt', 'local only\n')
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', 'local diverges')
    mateSync()
    write(other, 'c.txt', 'mate only\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'mate diverges')
    git(other, 'push', '-q')
    await click('commit-pull')
    check(
      'a diverged pull is refused with git\'s message',
      !!(await waitFor(async () => /fast-forward|diverg/i.test(await text('status-msg')), 15000)),
      await text('status-msg')
    )
    check('no merge commit was created', git(root, 'log', '-1', '--format=%s') === 'local diverges')
    git(root, 'fetch', '-q')
    git(root, 'reset', '-q', '--hard', 'origin/main')

    // Stash (includes untracked) and pop
    key('0', ['alt'])
    write(root, 'a.txt', 'one\ntwo\nlocal\nTEAMMATE-LINE\nMY-WIP\n')
    write(root, 'u.txt', 'untracked\n')
    await refresh()
    await waitFor(async () => (await text('commit-summary')) === '2 changes', 5000)
    await click('commit-stash')
    await menuOpen()
    await menuClick('Stash Changes')
    await sleep(200)
    await ask('wip')
    check('stashing leaves a clean working tree', !!(await waitFor(() => git(root, 'status', '--porcelain') === '', 10000)), git(root, 'status', '--porcelain'))
    check('the stash is recorded with its message', git(root, 'stash', 'list').includes('wip'))
    check('the untracked file went into the stash too', !fs.existsSync(path.join(root, 'u.txt')))
    await click('commit-stash')
    await menuOpen()
    await menuClick('Pop:')
    check(
      'Pop restores the changes and the untracked file',
      !!(await waitFor(() => fs.existsSync(path.join(root, 'u.txt')) && fs.readFileSync(path.join(root, 'a.txt'), 'utf8').includes('MY-WIP'), 10000))
    )
    check('the stash list is empty after popping', git(root, 'stash', 'list') === '')

    // Revert a modification, delete an untracked file
    await refresh()
    await waitFor(async () => (await text('commit-summary')) === '2 changes', 5000)
    await rightClickChange('a.txt')
    await sleep(200)
    await menuClick('Revert')
    check(
      'Revert restores the file from HEAD',
      !!(await waitFor(() => !fs.readFileSync(path.join(root, 'a.txt'), 'utf8').includes('MY-WIP'), 10000))
    )
    await waitFor(async () => (await text('commit-summary')) === '1 change', 5000)
    await rightClickChange('u.txt')
    await sleep(200)
    await menuClick('Delete')
    check('Delete removes an untracked file', !!(await waitFor(() => !fs.existsSync(path.join(root, 'u.txt')), 10000)))
    check('the Commit window ends up clean', !!(await waitFor(async () => (await text('commit-summary')) === 'No changes', 5000)))

    // A new branch is published with its first push
    await click('branch-widget')
    await menuOpen()
    await menuClick('New Branch')
    await sleep(200)
    await ask('feature')
    await waitFor(async () => (await widget()).startsWith('feature'), 8000)
    await click('commit-push')
    check(
      'pushing a new branch publishes it and sets the upstream',
      !!(await waitFor(() => git(bare, 'branch', '--list', 'feature').includes('feature'), 15000)) &&
        !!(await waitFor(() => git(root, 'rev-parse', '--abbrev-ref', 'feature@{upstream}') === 'origin/feature', 5000))
    )
  } finally {
    // Servers aren't involved here, but keep the temp dirs from piling up.
    fs.rmSync(bare, { recursive: true, force: true })
    fs.rmSync(other, { recursive: true, force: true })
  }
})
