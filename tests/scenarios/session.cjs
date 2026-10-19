// @ts-check
// Session restore: the last project, tabs and layout come back; a deleted file doesn't stop the rest;
// changes are saved as you work; recent projects are listed.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

const STATE = [
  '{',
  '  "lastFolder": "{{ROOT}}",',
  '  "recents": ["{{ROOT}}", "C:\\\\gone\\\\elsewhere"],',
  '  "openFiles": ["{{ROOT}}\\\\a.txt", "{{ROOT}}\\\\b.txt", "{{ROOT}}\\\\missing.txt"],',
  '  "activeFile": "{{ROOT}}\\\\a.txt",',
  '  "layout": { "projectWidth": 333, "bottomHeight": 150, "bottomHidden": true, "side": "commit" }',
  '}'
].join('\n')

run(
  'session',
  { 'a.txt': 'aaa\n', 'b.txt': 'bbb\n', 'c.txt': 'ccc\n' },
  async (t) => {
    const { js, key, waitFor, check, userData, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const state = () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'))
      } catch {
        return {} // not written yet
      }
    }

    check('the last project reopens by itself', !!(await waitFor(async () => (await text('project-name')) === path.basename(root), 10000)), await text('project-name'))
    check(
      'its tabs reopen',
      !!(await waitFor(async () => (await text('tabs')).includes('a.txt') && (await text('tabs')).includes('b.txt'), 8000)),
      await text('tabs')
    )
    check('the previously active tab is active again', (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('a.txt'))
    check(
      'a file deleted since last time is reported, and the others still opened',
      !!(await waitFor(async () => (await text('log')).includes('missing.txt'), 5000)) && (await text('tabs')).includes('b.txt')
    )
    check('the panel sizes come back', Math.abs((await js("document.getElementById('project').offsetWidth")) - 333) <= 2, String(await js("document.getElementById('project').offsetWidth")))
    check('the bottom window comes back hidden', await js("document.getElementById('bottom').hidden"))
    check('the Commit window comes back as the side view', await js("!document.getElementById('commit-view').hidden"))
    check('recent projects are listed', (await text('recents')).includes(path.basename(root)) && (await text('recents')).includes('elsewhere'), await text('recents'))

    // Saved as you go
    await js("document.querySelector('.btab[data-win=\"project\"]').click()")
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'c.txt').click()")
    check(
      'opening another file is saved to state.json',
      !!(await waitFor(() => (state().openFiles ?? []).some((/** @type {string} */ p) => p.endsWith('c.txt')), 4000)),
      JSON.stringify(state().openFiles)
    )
    check('so is the active tab', !!(await waitFor(() => (state().activeFile ?? '').endsWith('c.txt'), 3000)))
    key('2', ['alt'])
    check('and a layout change', !!(await waitFor(() => state().layout?.bottomHidden === false, 4000)), JSON.stringify(state().layout))
    check('the restore did not clobber the saved project', state().lastFolder === root, String(state().lastFolder))
  },
  { userData: { 'state.json': STATE } }
)
