// @ts-check
// Change marks in the editor gutter (added / modified / removed since the last commit), rolling a change back from
// the mark, jumping between changes, and no marks for a file git does not track.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

const ORIGINAL = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'

run('git-gutter', { 'a.txt': ORIGINAL, 'u.txt': 'untracked\n' }, async (t) => {
  const { js, key, type, enter, check, sleep, waitFor, root, wc } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const git = (/** @type {string[]} */ ...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  const count = (/** @type {string} */ kind) => js(`document.querySelectorAll('#editor .git-gutter-${kind}').length`)
  // Monaco recycles line elements, so their order in the DOM is not the order on screen: sort by position.
  const editorLines = () =>
    js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('|')")
  const pos = () => text('st-pos')
  const mouseClick = async (/** @type {string} */ elementExpr) => {
    const box = await js(`(() => { const r = (${elementExpr}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    wc.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y })
    wc.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  }

  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Forge Test')
  git('config', 'user.email', 'test@example.com')
  git('config', 'core.autocrlf', 'false')
  git('config', 'commit.gpgsign', 'false')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'base')

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)
  await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'a.txt').click()")
  await waitFor(async () => (await text('tabs')).includes('a.txt'), 3000)
  await sleep(800)
  check('an unchanged file has no marks', (await count('added')) + (await count('modified')) + (await count('removed')) === 0)

  // ---- make three kinds of change ----
  await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
  key('End', ['control'])
  enter()
  await type('a brand new line') // added at the end
  key('Home', ['control'])
  key('Down')
  key('Down')
  key('End')
  await type(' CHANGED') // line 3 modified
  key('Home', ['control'])
  for (let i = 0; i < 5; i++) key('Down')
  key('K', ['control', 'shift']) // line 6 deleted
  check('an added line gets a green mark', !!(await waitFor(async () => (await count('added')) >= 1, 4000)))
  check('a modified line gets a blue mark', !!(await waitFor(async () => (await count('modified')) >= 1, 4000)))
  check('a removed line leaves a red wedge', !!(await waitFor(async () => (await count('removed')) >= 1, 4000)))

  // ---- next / previous change ----
  key('Home', ['control'])
  key('Down', ['control', 'alt', 'shift'])
  check('Next Change jumps to the first change below', !!(await waitFor(async () => (await pos()).startsWith('3:'), 3000)), await pos())
  key('Down', ['control', 'alt', 'shift'])
  check('...and the one after it', !!(await waitFor(async () => (await pos()).startsWith('6:'), 3000)), await pos())
  key('Up', ['control', 'alt', 'shift'])
  check('Previous Change goes back', !!(await waitFor(async () => (await pos()).startsWith('3:'), 3000)), await pos())

  // ---- roll the modified line back from its mark ----
  await mouseClick("document.querySelector('#editor .git-gutter-modified')")
  await sleep(300)
  check('clicking a mark offers the change\'s actions', (await js("[...document.querySelectorAll('#ctx .ctx-item')].map(i => i.textContent).join('|')")).includes('Rollback Changes'))
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === 'Rollback Changes').click()")
  check('Rollback Changes restores the old text', !!(await waitFor(async () => (await editorLines()).includes('line 3|') && !(await editorLines()).includes('CHANGED'), 4000)), await editorLines())
  check('...and its mark goes away', !!(await waitFor(async () => (await count('modified')) === 0, 4000)))

  // ---- roll the removed line back ----
  await mouseClick("document.querySelector('#editor .git-gutter-removed')")
  await sleep(300)
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === 'Rollback Changes').click()")
  check('rolling back a removal puts the line back', !!(await waitFor(async () => (await editorLines()).includes('line 6|line 7'), 4000)), await editorLines())

  // ---- roll the added line back ----
  await mouseClick("document.querySelector('#editor .git-gutter-added')")
  await sleep(300)
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.startsWith('Rollback')).click()")
  check('rolling back an addition removes the line', !!(await waitFor(async () => !(await editorLines()).includes('brand new'), 4000)), await editorLines())
  check('with everything rolled back the file equals the commit again', !!(await waitFor(async () => (await count('added')) + (await count('modified')) + (await count('removed')) === 0, 4000)), `added=${await count('added')} modified=${await count('modified')} removed=${await count('removed')} ${await editorLines()}`)

  // ---- Annotate with Git Blame ----
  const runPalette = async (/** @type {string} */ query) => {
    key('P', ['control', 'shift'])
    await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
    await type(query)
    await sleep(300)
    key('Enter')
    await sleep(300)
  }
  const gutterText = () => js("[...document.querySelectorAll('#editor .line-numbers')].map(l => l.textContent).join('|')")
  await runPalette('annotate with git blame')
  check('annotating an edited file asks to save first', (await text('log')).includes('Save the file first'))
  key('S', ['control'])
  await waitFor(async () => !(await js("!!document.querySelector('.tab .dot')")), 3000)
  await runPalette('annotate with git blame')
  check('Annotate shows who last changed each line', !!(await waitFor(async () => (await gutterText()).includes('Forge Test') && /\d{4}-\d{2}-\d{2}/.test(await gutterText()), 4000)), await gutterText())
  await runPalette('annotate with git blame')
  check('...and toggling again takes it away', !!(await waitFor(async () => !(await gutterText()).includes('Forge Test'), 4000)), await gutterText())

  // ---- a file git does not track has no marks ----
  await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'u.txt').click()")
  await waitFor(async () => (await text('tabs')).includes('u.txt'), 3000)
  await sleep(800)
  check('an untracked file has no marks', (await count('added')) === 0)

  // ---- the setting ----
  await js("document.querySelector('.tab').click()")
  await waitFor(async () => (await editorLines()).includes('line 1'), 3000)
  await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
  key('End', ['control'])
  enter()
  await type('another')
  await waitFor(async () => (await count('added')) >= 1, 4000)
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await type('toggle git changes')
  await sleep(300)
  key('Enter')
  check('turning "Show git changes in the gutter" off removes the marks', !!(await waitFor(async () => (await count('added')) === 0, 4000)))
  fs.writeFileSync(path.join(root, 'noop.txt'), '') // keep the fixture non-empty for cleanup symmetry
})
