// @ts-check
// Postfix templates: `expression.keyword` is offered as a completion and rewrites the expression when accepted.
const { run } = require('../harness.cjs')

run('postfix', { 'a.ts': '', 'b.py': '' }, async (t) => {
  const { js, key, type, check, sleep, waitFor } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const editorLines = () => js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\\u00a0/g, ' ')).join('\\n')")
  const open = async (/** @type {string} */ name) => {
    await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
    await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes(name), 3000)
    await sleep(500)
    await js("document.querySelector('#editor textarea').focus(); undefined")
    await sleep(200)
  }

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)

  // ---- TypeScript ----
  await open('a.ts')
  await type('user.log')
  check('the template is offered as a suggestion', !!(await waitFor(async () => (await js("document.querySelector('.suggest-widget.visible')?.textContent ?? ''")).includes('console.log(expr)'), 8000)), await js("document.querySelector('.suggest-widget')?.textContent ?? ''"))
  key('Tab')
  check('accepting it rewrites the expression', !!(await waitFor(async () => (await editorLines()).includes('console.log(user)'), 4000)), await editorLines())

  // a call chain is the expression, and the typed text before it stays
  key('A', ['control'])
  key('Delete')
  await sleep(200)
  await type('const n = getItems(1).list.for')
  await waitFor(async () => (await js("document.querySelector('.suggest-widget.visible')?.textContent ?? ''")).includes('for (const item of expr)'), 8000)
  key('Tab')
  check('a call chain is taken whole, and the code before it stays', !!(await waitFor(async () => /const n = for \(const item of getItems\(1\)\.list\)/.test(await editorLines()), 4000)), await editorLines())

  // ---- Python ----
  await open('b.py')
  await type('names.print')
  await waitFor(async () => (await js("document.querySelector('.suggest-widget.visible')?.textContent ?? ''")).includes('print(expr)'), 8000)
  key('Tab')
  check('Python has its own templates', !!(await waitFor(async () => (await editorLines()).includes('print(names)'), 4000)), await editorLines())

  // ---- the setting ----
  key(',', ['control'])
  await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
  await js("document.querySelector('.snav[data-cat=\"Editor\"]').click()")
  await sleep(500)
  await js("[...document.querySelectorAll('.srow')].find(r => r.querySelector('.label')?.textContent === 'Postfix templates').querySelector('.switch').click()")
  await js("document.getElementById('settings-close').click()")
  await open('a.ts')
  key('A', ['control'])
  key('Delete')
  await sleep(200)
  await type('value.log')
  await sleep(1500)
  check('with the setting off no template is offered', !(await js("document.querySelector('.suggest-widget.visible')?.textContent ?? ''")).includes('console.log(expr)'))
})
