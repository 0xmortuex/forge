// A stand-in for the GitHub CLI, used by the Pull Requests tests (FORGE_GH points here). It answers like gh does and records
// every call in the file named by FAKE_GH_LOG, one JSON array of arguments per line.
const fs = require('node:fs')

const args = process.argv.slice(2)
if (process.env['FAKE_GH_LOG']) fs.appendFileSync(process.env['FAKE_GH_LOG'], JSON.stringify(args) + '\n')

const out = (/** @type {string} */ s) => process.stdout.write(s + '\n')
const fail = (/** @type {string} */ s, code = 1) => {
  process.stderr.write(s + '\n')
  process.exit(code)
}

const ago = (/** @type {number} */ minutes) => new Date(Date.now() - minutes * 60000).toISOString()
const PRS = [
  { number: 12, title: 'Add dark mode', author: { login: 'ada' }, headRefName: 'dark-mode', baseRefName: 'main', isDraft: true, state: 'OPEN', updatedAt: ago(5), url: 'https://github.com/octo/forge-demo/pull/12', reviewDecision: '', statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }] },
  { number: 11, title: 'Fix the parser', author: { login: 'bob' }, headRefName: 'fix-parser', baseRefName: 'main', isDraft: false, state: 'OPEN', updatedAt: ago(180), url: 'https://github.com/octo/forge-demo/pull/11', reviewDecision: 'APPROVED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] },
  { number: 10, title: 'Rework settings', author: { login: 'eve' }, headRefName: 'settings', baseRefName: 'main', isDraft: false, state: 'OPEN', updatedAt: ago(3000), url: 'https://github.com/octo/forge-demo/pull/10', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] },
  { number: 9, title: 'Old feature', author: { login: 'ada' }, headRefName: 'old', baseRefName: 'main', isDraft: false, state: 'MERGED', updatedAt: ago(90000), url: 'https://github.com/octo/forge-demo/pull/9', reviewDecision: 'APPROVED', statusCheckRollup: [] }
]

const [a, b] = args
if (a === '--version') out('gh version 0.0.0 (fake)')
else if (a === 'auth') {
  if (process.env['FAKE_GH_AUTH'] === '0') fail('You are not logged into any GitHub hosts. Run gh auth login to authenticate.')
  out('Logged in to github.com as tester')
} else if (a === 'repo' && b === 'view') out('octo/forge-demo')
else if (a === 'pr' && b === 'list') {
  const state = args[args.indexOf('--state') + 1]
  out(JSON.stringify(PRS.filter((p) => state === 'all' || p.state.toLowerCase() === state)))
} else if (a === 'pr' && b === 'view') {
  const pr = PRS.find((p) => String(p.number) === args[2])
  if (!pr) fail(`no pull requests found for ${args[2]}`)
  out(
    JSON.stringify({
      ...pr,
      body: '## Why\nBecause **reasons**.',
      additions: 12,
      deletions: 3,
      files: [{ path: 'src/parser.ts', additions: 10, deletions: 3 }, { path: 'README.md', additions: 2, deletions: 0 }],
      comments: [{ author: { login: 'eve' }, body: 'Looks `good`', createdAt: ago(60) }],
      reviews: [{ author: { login: 'bob' }, state: 'APPROVED', body: '' }],
      mergeable: 'MERGEABLE'
    })
  )
} else if (a === 'pr' && b === 'diff') out('diff --git a/src/parser.ts b/src/parser.ts\n--- a/src/parser.ts\n+++ b/src/parser.ts\n@@ -1 +1 @@\n-old\n+new')
else if (a === 'pr' && b === 'checkout') {
  if (args[2] === '99') fail('could not find pull request 99')
  fail(`Switched to branch 'pr-${args[2]}'`, 0)
} else if (a === 'pr' && b === 'comment') out('https://github.com/octo/forge-demo/pull/11#issuecomment-1')
else if (a === 'pr' && b === 'create') out('Creating pull request for dark-mode into main\n\nhttps://github.com/octo/forge-demo/pull/13')
else fail(`fake gh: unexpected arguments ${JSON.stringify(args)}`)
