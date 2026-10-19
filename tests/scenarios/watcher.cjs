// @ts-check
// Changes made outside Forge: new and deleted files appear in the tree (without collapsing open folders), open files
// reload when they have no unsaved edits, unsaved edits are never overwritten, Forge's own saves are not mistaken for
// outside changes, and git activity on the command line updates the git widgets.
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('watcher', { 'a.txt': 'original\n', 'src/b.ts': 'export const b = 1\n', 'src/deep/c.txt': 'c\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const node = (/** @type {string} */ name) => `[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)})`
  const has = (/** @type {string} */ name) => js(`!!${node(name)}`)
  const abs = (/** @type {string} */ rel) => path.join(root, rel)
  const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('|')")
  const logText = () => text('log')
  const treeNames = () => js("[...document.querySelectorAll('.node')].map(n => n.textContent + (n.nextElementSibling && n.nextElementSibling.tagName === 'DIV' && !n.querySelector('.fbadge') && n.querySelector('.twisty').innerHTML ? (n.nextElementSibling.hidden ? '(closed)' : '(open)') : '')).join(',')")

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('src'), 5000)
  await js(`${node('src')}.click()`)
  await waitFor(() => has('deep'), 3000)
  await js(`${node('deep')}.click()`)
  await waitFor(() => has('c.txt'), 3000)

  // ---- tree ----
  fs.writeFileSync(abs('new.txt'), 'hello\n')
  check('a file created outside Forge appears in the tree', !!(await waitFor(() => has('new.txt'), 6000)))
  fs.writeFileSync(abs('src/deep/d.txt'), 'd\n')
  check('...also inside an open folder', !!(await waitFor(() => has('d.txt'), 6000)), `${await treeNames()} || ${(await logText()).slice(-200)}`)
  fs.writeFileSync(abs('src/e.ts'), 'export {}\n')
  await waitFor(() => has('e.ts'), 6000)
  check('...and the open subfolder stays open while its parent is refreshed', (await has('c.txt')) && (await has('d.txt')))
  fs.rmSync(abs('new.txt'))
  check('a file deleted outside Forge leaves the tree', !!(await waitFor(async () => !(await has('new.txt')), 6000)))

  // ---- open files ----
  await js(`${node('a.txt')}.click()`)
  await waitFor(async () => (await text('tabs')).includes('a.txt'), 3000)
  fs.writeFileSync(abs('a.txt'), 'changed elsewhere\n')
  check('an open file without unsaved edits reloads', !!(await waitFor(async () => (await editorText()).includes('changed elsewhere'), 6000)), await editorText())
  check('...and says so', (await logText()).includes('Reloaded a.txt'))
  check('...without being marked as modified', !(await js("!!document.querySelector('.tab .dot')")))

  // unsaved edits are never overwritten
  await js(`${node('b.ts')}.click()`)
  await waitFor(async () => (await text('tabs')).includes('b.ts'), 3000)
  await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
  key('End', ['control'])
  await type(' // mine')
  await sleep(300)
  fs.writeFileSync(abs('src/b.ts'), 'export const b = 2 // theirs\n')
  check('an open file WITH unsaved edits is left alone, with a warning', !!(await waitFor(async () => (await logText()).includes('b.ts changed on disk, but you have unsaved edits'), 6000)))
  check('...its text is still the user\'s', (await editorText()).includes('// mine') && !(await editorText()).includes('theirs'), await editorText())

  // Forge's own save is not an outside change
  const warnings = (await logText()).split('changed on disk').length
  key('S', ['control'])
  await sleep(1500)
  check('saving from Forge does not trigger a "changed on disk" warning', (await logText()).split('changed on disk').length === warnings)
  check('...and the file on disk is the user\'s text', fs.readFileSync(abs('src/b.ts'), 'utf8').includes('// mine'))

  // ---- git on the command line ----
  check('before there is a repository, no branch is shown', await js("document.getElementById('branch-widget').hidden"))
  // Not spawnSync: this scenario runs inside the app's own process, and a blocked event loop makes Windows drop file events.
  const git = (/** @type {string[]} */ ...args) => promisify(execFile)('git', args, { cwd: root })
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.name', 'T')
  await git('config', 'user.email', 't@t')
  await git('config', 'commit.gpgsign', 'false')
  await git('add', '-A')
  await git('commit', '-q', '-m', 'from the command line')
  check('a repository created outside Forge shows its branch', !!(await waitFor(async () => !(await js("document.getElementById('branch-widget').hidden")) && (await text('branch-name')) === 'main', 8000)), `${await text('branch-name')} || ${(await logText()).slice(-300)}`)
  await git('switch', '-q', '-c', 'feature')
  check('a branch switched outside Forge is picked up', !!(await waitFor(async () => (await text('branch-name')) === 'feature', 8000)))
})
