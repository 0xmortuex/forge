// @ts-check
// Partial commits: choose hunks and single lines of a file, commit only those, and nothing else changes.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

const lines = (/** @type {Record<number, string>} */ changes = {}, /** @type {string[]} */ insertAfter10 = []) => {
  const out = []
  for (let i = 1; i <= 20; i++) {
    out.push(changes[i] ?? `line${String(i).padStart(2, '0')}`)
    if (i === 10) out.push(...insertAfter10)
  }
  return out.join('\n') + '\n'
}

run('git-partial', { 'a.txt': lines(), 'b.txt': 'b one\nb two\n', 'c.txt': 'c one\n' }, async (t) => {
  const { js, key, check, sleep, waitFor, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const git = (/** @type {string[]} */ ...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  const out = (/** @type {string[]} */ ...args) => git(...args).stdout

  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'T')
  git('config', 'user.email', 't@t')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'initial')
  // Three changes in a.txt, each far enough apart to be its own hunk; one in b.txt; a staged-by-hand change in c.txt.
  fs.writeFileSync(path.join(root, 'a.txt'), lines({ 2: 'LINE02 changed', 18: 'LINE18 changed' }, ['inserted']))
  fs.writeFileSync(path.join(root, 'b.txt'), 'b one\nb two changed\n')
  fs.writeFileSync(path.join(root, 'c.txt'), 'c one\nc two staged\n')
  git('add', 'c.txt')

  const row = (/** @type {string} */ name) => `[...document.querySelectorAll('#commit-list .change')].find(r => r.querySelector('.name')?.textContent === ${JSON.stringify(name)})`

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  key('0', ['alt'])
  await waitFor(() => js(`!!(${row('a.txt')})`), 8000)

  // ---- choose changes ----
  await js(`${row('a.txt')}.querySelector('.partial-pick').click()`)
  check('the dialog opens with the file\'s hunks', !!(await waitFor(() => js("!!document.getElementById('partial') && document.querySelectorAll('#partial .partial-hunk').length === 3"), 6000)), String(await js("document.querySelectorAll('#partial .partial-hunk').length")))
  check('everything is ticked at first', (await text('partial-count')).includes('5 of 5'), await text('partial-count'))
  await js("[...document.querySelectorAll('#partial .partial-line.add')].find(l => l.textContent.includes('inserted')).querySelector('input').click()")
  check('a single line can be unticked', !!(await waitFor(async () => (await text('partial-count')).includes('4 of 5'), 3000)), await text('partial-count'))
  await js("document.querySelectorAll('#partial .partial-hunk-box')[2].click()")
  check('a whole hunk can be unticked', !!(await waitFor(async () => (await text('partial-count')).includes('2 of 5'), 3000)), await text('partial-count'))
  await js("document.getElementById('partial-done').click()")
  check('the dialog closes and the file shows how much will be committed', !!(await waitFor(async () => (await js(`${row('a.txt')}.querySelector('.partial-badge')?.textContent ?? ''`)) === '2/5', 4000)), String(await js(`${row('a.txt')}.querySelector('.partial-badge')?.textContent ?? ''`)))

  // Re-opening shows the same ticks.
  await js(`${row('a.txt')}.querySelector('.partial-pick').click()`)
  await waitFor(() => js("!!document.getElementById('partial')"), 4000)
  check('re-opening the dialog shows the earlier choice', (await text('partial-count')).includes('2 of 5'), await text('partial-count'))
  await js("document.getElementById('partial-cancel').click()")
  check('Cancel keeps it as it was', (await js(`${row('a.txt')}.querySelector('.partial-badge')?.textContent ?? ''`)) === '2/5')

  // ---- the commit ----
  await js(`${row('c.txt')}.querySelector('input[type=checkbox]').click()`) // leave c.txt out
  await js("document.getElementById('commit-msg').value = 'Partial commit'; undefined")
  await js("document.getElementById('commit-btn').click()")
  check('the commit is made', !!(await waitFor(() => out('log', '-1', '--format=%s').trim() === 'Partial commit', 10000)), out('log', '-1', '--format=%s'))
  const committedFiles = out('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()
  check('it contains a.txt and b.txt only', committedFiles.join(',') === 'a.txt,b.txt', committedFiles.join(','))
  const committedA = out('show', 'HEAD:a.txt')
  check('a.txt in the commit has the chosen change only', committedA.includes('LINE02 changed') && !committedA.includes('LINE18 changed') && !committedA.includes('inserted'), committedA)
  check('b.txt went in whole', out('show', 'HEAD:b.txt').includes('b two changed'))
  const working = fs.readFileSync(path.join(root, 'a.txt'), 'utf8')
  check('the working file still has every change', working.includes('LINE02 changed') && working.includes('LINE18 changed') && working.includes('inserted'))
  const remaining = out('diff', 'HEAD', '--', 'a.txt')
  check('what was left out is still uncommitted', remaining.includes('+LINE18 changed') && remaining.includes('+inserted') && !remaining.includes('LINE02'), remaining)
  const porcelain = out('status', '--porcelain')
  check('a.txt is still modified, b.txt is clean', /^ M a\.txt$/m.test(porcelain) && !/b\.txt/.test(porcelain), porcelain)
  check('the file staged by hand is still staged', /^M  c\.txt$/m.test(porcelain), porcelain)
  check('no temporary index is left behind', !fs.readdirSync(path.join(root, '.git')).some((f) => f.startsWith('forge-index-')))

  // ---- guard rails ----
  await waitFor(() => js(`!!(${row('a.txt')})`), 6000)
  await js(`${row('a.txt')}.querySelector('.partial-pick').click()`)
  await waitFor(() => js("!!document.getElementById('partial')"), 4000)
  await js("document.querySelectorAll('#partial .partial-hunk-box')[0].click()") // leave the first remaining hunk out
  await js("document.getElementById('partial-done').click()")
  await sleep(300)
  await js("document.getElementById('commit-amend').click()")
  await js("document.getElementById('commit-msg').value = 'x'; undefined")
  await js("document.getElementById('commit-btn').click()")
  check('Amend refuses a partial selection, saying why', !!(await waitFor(async () => (await text('log')).includes('Amend cannot commit only some changes'), 4000)), (await text('log')).slice(-250))
  await js("document.getElementById('commit-amend').click()")

  fs.appendFileSync(path.join(root, 'a.txt'), 'changed behind its back\n')
  await sleep(500)
  await js("document.getElementById('commit-msg').value = 'stale'; undefined")
  await js("document.getElementById('commit-btn').click()")
  check('a file that changed after the choice is not committed blindly', !!(await waitFor(async () => (await text('log')).includes('changed since you chose its changes'), 6000)), (await text('log')).slice(-250))
  check('...and nothing was committed', out('log', '-1', '--format=%s').trim() === 'Partial commit')
})
