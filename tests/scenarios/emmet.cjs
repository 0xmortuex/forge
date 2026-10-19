// @ts-check
// Emmet: abbreviations expand in HTML and CSS files, and Tab keeps working normally everywhere else.
const { run } = require('../harness.cjs')

run('emmet', { 'page.html': '', 'style.css': '', 'notes.txt': '' }, async (t) => {
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
  await waitFor(async () => (await text('tree')).includes('page.html'), 5000)

  // ---- HTML ----
  await open('page.html')
  await type('ul>li*2')
  await sleep(800)
  key('Tab')
  await sleep(500)
  const html = await editorLines()
  check('ul>li*2 expands to a list with two items', /<ul>/.test(html) && (html.match(/<li><\/li>/g) ?? []).length === 2 && /<\/ul>/.test(html), html)

  // A class and an id with a nested element.
  key('A', ['control'])
  key('Delete')
  await sleep(200)
  await type('div#app.main>p.lead{Hello}')
  await sleep(800)
  key('Tab')
  await sleep(500)
  const html2 = await editorLines()
  check('div#app.main>p.lead{Hello} expands with attributes and text', html2.includes('<div id="app" class="main">') && html2.includes('<p class="lead">Hello</p>'), html2)

  // ---- CSS ----
  await open('style.css')
  await type('df')
  await sleep(800)
  key('Tab')
  await sleep(500)
  const css = await editorLines()
  check('df expands to display: flex;', css.includes('display: flex;'), css)

  // ---- a plain text file: Tab is just Tab ----
  await open('notes.txt')
  await type('ul>li*2')
  await sleep(500)
  key('Tab')
  await sleep(300)
  const plain = await editorLines()
  check('in a plain text file nothing is expanded', !plain.includes('<li>') && plain.startsWith('ul>li*2'), plain)
})
