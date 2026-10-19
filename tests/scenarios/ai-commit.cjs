// @ts-check
// "Generate message" in the Commit window describes the ticked changes (tracked ones as a diff, new files by their
// content) and fills the message box.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')
const { startMockAi } = require('../mock-ai.cjs')

startMockAi().then((mock) =>
  run(
    'ai-commit',
    { 'a.txt': 'one\n' },
    async (t) => {
      const { js, key, check, sleep, waitFor, root } = t
      const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
      const git = (/** @type {string[]} */ ...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' })
      git('init', '-q', '-b', 'main')
      git('config', 'user.name', 'T')
      git('config', 'user.email', 't@t')
      git('config', 'commit.gpgsign', 'false')
      git('add', '-A')
      git('commit', '-q', '-m', 'init')
      fs.writeFileSync(path.join(root, 'a.txt'), 'one\nCHANGED-LINE\n')
      fs.writeFileSync(path.join(root, 'new.txt'), 'brand new file body\n')

      key('O', ['control'])
      await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
      key('0', ['alt'])
      await waitFor(() => js("document.querySelectorAll('#commit-list .crow, #commit-list .row, #commit-list [data-path]').length >= 2"), 8000)
      await js("document.getElementById('commit-ai-btn').click()")
      check('the message box is filled from the AI answer', !!(await waitFor(async () => (await js("document.getElementById('commit-msg').value")).startsWith('Add mock feature'), 8000)), await js("document.getElementById('commit-msg').value"))
      const req = mock.requests.find((r) => (r.body?.messages?.[0]?.content ?? '').includes('git commit messages'))
      const prompt = req?.body.messages[1].content ?? ''
      check('the prompt contains the diff of the tracked file', prompt.includes('CHANGED-LINE') && prompt.includes('diff --git'), prompt.slice(0, 200))
      check('...and the content of the new file', prompt.includes('new file new.txt') && prompt.includes('brand new file body'), prompt.slice(-200))
      check('the button is usable again', !(await js("document.getElementById('commit-ai-btn').disabled")) && (await text('commit-ai-btn')) === 'Generate message')

      // The generated message can be committed as it is.
      await js("document.getElementById('commit-btn').click()")
      check('committing with it works', !!(await waitFor(() => git('log', '-1', '--format=%s').stdout.trim() === 'Add mock feature', 8000)), git('log', '-1', '--format=%s').stdout)
    },
    {
      userData: {
        'settings.json': JSON.stringify({ aiBaseUrl: `http://127.0.0.1:${mock.port}/v1`, aiModel: 'mock-model' })
      }
    }
  ).finally(() => mock.close())
)
