// @ts-check
// The Viewer window: a CSV as a sortable, filterable table; a notebook rendered; any file as a hex dump.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

const CSV = 'name,age,city\nBob,30,LA\nAlice,5,NY\n"Smith, J",100,"San ""Fran"""\n'
const NOTEBOOK = JSON.stringify({
  metadata: { language_info: { name: 'python' } },
  cells: [
    { cell_type: 'markdown', source: ['# Heading\n', 'some **bold** text'] },
    { cell_type: 'code', execution_count: 1, source: ['print("hi")'], outputs: [{ output_type: 'stream', text: ['hi\n'] }] },
    { cell_type: 'code', execution_count: 2, source: ['1/0'], outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: ['ZeroDivisionError: division by zero'] }] }
  ]
})

run('viewer', { 'data.csv': CSV, 'nb.ipynb': NOTEBOOK, 'plain.txt': 'hello\n' }, async (t) => {
  const { js, key, type, check, sleep, waitFor, root } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
  const open = async (/** @type {string} */ name) => {
    await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
    await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes(name), 3000)
    await sleep(500)
  }
  const hexText = () => js("document.getElementById('viewer-hex')?.textContent ?? ''")
  const cells = (/** @type {string} */ sel) => js(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.textContent)`)
  const rowsOf = () => js("[...document.querySelectorAll('#viewer-body .viewer-table tbody tr')].map(tr => [...tr.querySelectorAll('td:not(.rownum)')].map(td => td.textContent).join('|'))")

  // A binary file, written before the project is opened.
  const bin = Buffer.alloc(5000)
  for (let i = 0; i < bin.length; i++) bin[i] = i % 256
  fs.writeFileSync(path.join(root, 'blob.bin'), bin)

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('blob.bin'), 5000)
  await open('data.csv')
  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await sleep(400)
  await type('Toggle Viewer')
  await sleep(600)
  key('Enter')
  check('the Viewer window opens', !!(await waitFor(() => js("!document.getElementById('view-viewer').hidden"), 3000)))

  // ---- table ----
  check('a CSV opens as a table, header from the first row', !!(await waitFor(async () => ((await cells('#viewer-body .viewer-table th:not(.rownum)')) || []).join(',') === 'name,age,city', 4000)), JSON.stringify(await cells('#viewer-body th')))
  const rows = await rowsOf()
  check('quoted cells keep their commas and quotes', rows[2] === 'Smith, J|100|San "Fran"', JSON.stringify(rows))
  check('the size is shown', (await text('viewer-info')) === '3 rows × 3 columns', await text('viewer-info'))

  await js("[...document.querySelectorAll('#viewer-body th')].find(th => th.textContent.startsWith('age')).click()")
  check('clicking a header sorts numerically (5 before 30 before 100)', !!(await waitFor(async () => (await rowsOf()).map((/** @type {string} */ r) => r.split('|')[1]).join(',') === '5,30,100', 3000)), JSON.stringify(await rowsOf()))
  await js("[...document.querySelectorAll('#viewer-body th')].find(th => th.textContent.startsWith('age')).click()")
  check('clicking again reverses it', !!(await waitFor(async () => (await rowsOf()).map((/** @type {string} */ r) => r.split('|')[1]).join(',') === '100,30,5', 3000)), JSON.stringify(await rowsOf()))

  await js("(() => { const f = document.getElementById('viewer-filter'); f.value = 'ali'; f.dispatchEvent(new Event('input')) })()")
  check('the filter keeps matching rows only', !!(await waitFor(async () => (await rowsOf()).length === 1 && (await rowsOf())[0].startsWith('Alice'), 3000)), JSON.stringify(await rowsOf()))
  check('and the count says so', (await text('viewer-info')) === '1 of 3 rows × 3 columns', await text('viewer-info'))
  await js("(() => { const f = document.getElementById('viewer-filter'); f.value = ''; f.dispatchEvent(new Event('input')) })()")

  // ---- hex of the same file ----
  await js("document.querySelector('#viewer-modes [data-mode=hex]').click()")
  check('Hex shows the file bytes ("name" = 6e 61 6d 65)', !!(await waitFor(async () => (await hexText()).startsWith('00000000  6e 61 6d 65 2c 61 67 65'), 3000)), (await js("document.getElementById('viewer-hex')?.textContent.slice(0, 80) ?? ''")))
  const hexLine = async () => (await hexText()).split('\n')[0]
  check('with the ASCII column', (await hexLine()).endsWith('|name,age,city.Bo|'), await hexLine())

  // ---- notebook ----
  await open('nb.ipynb')
  check('a notebook opens in Notebook mode', !!(await waitFor(async () => (await js("document.querySelectorAll('#viewer-body .nb-cell').length")) === 3, 4000)), await text('viewer-info'))
  check('markdown cells are rendered', (await js("document.querySelector('#viewer-body .nb-markdown h1')?.textContent")) === 'Heading' && (await js("document.querySelector('#viewer-body .nb-markdown strong')?.textContent")) === 'bold')
  check('code cells show their number and output', (await text('viewer-body')).includes('In [1]:') && (await js("document.querySelector('#viewer-body .nb-output pre')?.textContent")) === 'hi\n')
  check('errors are marked as errors', (await js("document.querySelector('#viewer-body .nb-error')?.textContent ?? ''")).includes('ZeroDivisionError'))
  check('the summary says how many cells', (await text('viewer-info')) === '3 cells · python', await text('viewer-info'))

  // ---- a text file has no table, only hex ----
  await open('plain.txt')
  check('Table/Notebook modes are offered for text files, Hex for all', !!(await waitFor(async () => ((await cells('#viewer-modes button')) || []).join(',') === 'Table,Notebook,Hex', 3000)), JSON.stringify(await cells('#viewer-modes button')))

  // ---- binary: paging ----
  await open('blob.bin')
  await waitFor(() => js('!!document.getElementById("viewer-hex")'), 4000)
  const first = (await hexText()).split('\n')
  check('a binary file opens as hex, 16 bytes per row', first.length === 256 && first[0].startsWith('00000000  00 01 02 03 04 05 06 07  08 09 0a 0b 0c 0d 0e 0f  |'), `${first.length} ${first[0]}`)
  check('the size is shown', (await text('viewer-info')).startsWith('4.9 KB'), await text('viewer-info'))
  check('Previous is disabled at the start', await js("document.getElementById('viewer-prev').disabled"))
  await js("document.getElementById('viewer-next').click()")
  check('Next shows the following page', !!(await waitFor(async () => (await hexText()).startsWith('00001000  00 01 02 03'), 3000)), (await js("document.getElementById('viewer-hex')?.textContent.slice(0, 40)")))
  check('the last page is shorter and Next is disabled', (await hexText()).split('\n').length === Math.ceil((5000 - 4096) / 16) && (await js("document.getElementById('viewer-next').disabled")), `${(await hexText()).split('\n').length}`)
})
