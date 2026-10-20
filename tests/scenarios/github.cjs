// @ts-check
// The Pull Requests window against a fake gh CLI: the list with checks and review state, details, diff, checkout, comment, create.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const log = path.join(os.tmpdir(), `forge-gh-${process.pid}.log`)
fs.writeFileSync(log, '')
process.env['FORGE_GH'] = path.join(__dirname, '..', 'fake-gh.cjs')
process.env['FAKE_GH_LOG'] = log
const { run } = require('../harness.cjs')

run('github', { 'a.txt': 'a\n' }, async (t) => {
  const { js, key, type, enter, check, sleep, waitFor } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const calls = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const called = (/** @type {string[]} */ ...prefix) => calls().some((c) => prefix.every((p, i) => c[i] === p))
  const rows = () => js("[...document.querySelectorAll('#gh-list .gh-pr')].map(r => r.dataset.number + ' ' + r.querySelector('.gh-pr-title').textContent)")
  const answer = async (/** @type {string} */ value) => {
    await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
    await js("document.getElementById('ask-input').select(); undefined")
    await type(value)
    enter()
    await sleep(500)
  }

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await sleep(400)
  await type('Toggle Pull Requests')
  await sleep(600)
  key('Enter')
  check('the window opens and names the repository', !!(await waitFor(async () => (await text('gh-repo')) === 'octo/forge-demo', 5000)), await text('gh-repo'))

  // ---- list ----
  check('the open pull requests are listed', !!(await waitFor(async () => (await rows()).length === 3, 4000)), JSON.stringify(await rows()))
  check('with their titles', (await rows()).join('|') === '12 Add dark mode|11 Fix the parser|10 Rework settings', JSON.stringify(await rows()))
  const checks = await js("[...document.querySelectorAll('#gh-list .gh-pr')].map(r => r.querySelector('.gh-checks').className.replace('gh-checks ', '')).join(',')")
  check('checks show as pending, passed and failed', checks === 'pending,pass,fail', checks)
  const badges = await js("[...document.querySelectorAll('#gh-list .gh-pr')].map(r => [...r.querySelectorAll('.gh-badge')].map(b => b.textContent).join('+')).join('|')")
  check('drafts and review decisions are badged', badges === 'Draft|Approved|Changes requested', badges)

  // ---- details ----
  await js("document.querySelector('#gh-list .gh-pr[data-number=\"11\"]').click()")
  check('selecting one shows its details', !!(await waitFor(async () => (await text('gh-detail')).includes('Fix the parser'), 4000)))
  const detail = await text('gh-detail')
  check('with files changed and their line counts', detail.includes('src/parser.ts') && detail.includes('+10') && detail.includes('−3'), detail.slice(0, 300))
  check('the description is rendered as Markdown', (await js("document.querySelector('#gh-detail .gh-text h2')?.textContent")) === 'Why' && (await js("document.querySelector('#gh-detail .gh-text strong')?.textContent")) === 'reasons')
  check('reviews and comments are shown', detail.includes('bob: approved') && detail.includes('Looks good'), detail.slice(-200))

  // ---- diff opens in a tab ----
  await js("document.getElementById('gh-diff').click()")
  check('View Diff opens the diff in the editor', !!(await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('.diff'), 5000)), await js("document.querySelector('.tab.active')?.textContent ?? ''"))
  check('and asked gh for that pull request', called('pr', 'diff', '11'))

  // ---- checkout ----
  await js("document.getElementById('view-github').scrollIntoView(); document.querySelector('#gh-list .gh-pr[data-number=\"10\"]').click()")
  await waitFor(async () => (await js("document.getElementById('gh-checkout')?.closest('.gh-card')?.querySelector('.gh-title')?.textContent ?? ''")).includes('Rework settings'), 4000)
  await js("document.getElementById('gh-checkout').click()")
  check('Checkout runs gh pr checkout and reports what it said', !!(await waitFor(async () => called('pr', 'checkout', '10') && (await text('log')).includes("Switched to branch 'pr-10'"), 5000)), (await text('log')).slice(-200))

  // ---- comment ----
  await js("document.getElementById('gh-comment').click()")
  await answer('LGTM, ship it')
  check('Add Comment sends the text through gh', !!(await waitFor(() => calls().some((c) => c[0] === 'pr' && c[1] === 'comment' && c[2] === '10' && c.includes('LGTM, ship it')), 4000)), JSON.stringify(calls().slice(-2)))

  // ---- create ----
  await js("document.getElementById('gh-new').click()")
  await answer('Add thing')
  await answer('because reasons')
  check('New Pull Request runs gh pr create with title and body', !!(await waitFor(() => calls().some((c) => c[0] === 'pr' && c[1] === 'create' && c.includes('Add thing') && c.includes('because reasons')), 4000)), JSON.stringify(calls().slice(-2)))
  check('and reports the new address', !!(await waitFor(async () => (await text('log')).includes('https://github.com/octo/forge-demo/pull/13'), 3000)))

  // ---- filter ----
  await js("(() => { const s = document.getElementById('gh-state'); s.value = 'merged'; s.dispatchEvent(new Event('change')) })()")
  check('the Merged filter lists only merged pull requests', !!(await waitFor(async () => (await rows()).join('|') === '9 Old feature', 4000)), JSON.stringify(await rows()))
  check('marked as merged', (await js("document.querySelector('#gh-list .gh-badge.merged')?.textContent")) === 'Merged')
})
