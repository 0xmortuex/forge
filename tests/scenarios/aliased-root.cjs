// @ts-check
// A project opened through an alias of its real folder (a junction here; on Windows runners the temp folder is
// reached through an 8.3 short name like RUNNER~1) must behave like one opened by its real path: git reports real
// paths, so the tree decorations and blame only line up if Forge works with the real path too.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { dialog } = require('electron')
const { run } = require('../harness.cjs')

run('aliased-root', { 'a.txt': 'one\ntwo\n' }, async (t) => {
  const { js, key, waitFor, check, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const git = (/** @type {string[]} */ ...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Forge Test')
  git('config', 'user.email', 'test@example.com')
  git('config', 'core.autocrlf', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'initial')
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\nTWO\n')
  fs.writeFileSync(path.join(root, 'c.txt'), 'new file\n')

  const link = path.join(os.tmpdir(), `forge-alias-${path.basename(root)}`)
  fs.symlinkSync(root, link, 'junction')
  try {
    dialog.showOpenDialog = /** @type {any} */ (async () => ({ canceled: false, filePaths: [link] }))
    const node = (/** @type {string} */ name) => `[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)})`

    key('O', ['control'])
    check(
      'the tree is decorated with git status when opened through an alias',
      !!(await waitFor(() => js(`${node('a.txt')}?.dataset.git === 'modified' && ${node('c.txt')}?.dataset.git === 'untracked'`), 8000))
    )
    check('the project is addressed by its real path', (await js(`${node('a.txt')}.dataset.path`)).toLowerCase().startsWith(fs.realpathSync.native(root).toLowerCase()), await js(`${node('a.txt')}.dataset.path`))

    await js(`${node('a.txt')}.click()`)
    await waitFor(async () => (await text('tabs')).includes('a.txt'), 3000)
    key('Home', ['control'])
    check('blame works for a file opened through the alias', !!(await waitFor(async () => (await text('st-blame')).includes('Forge Test'), 8000)), await text('st-blame'))
  } finally {
    fs.rmSync(link, { force: true }) // removes the junction, not the folder it points at
  }
})
