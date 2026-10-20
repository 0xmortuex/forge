// @ts-check
// File encodings: detected on open, kept on save, convertible from the status bar, and never silently corrupted.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'encoding',
  { 'plain.txt': 'plain\n', 'euro.txt': 'price 5€\n' },
  async (t) => {
    const { js, key, type, check, sleep, waitFor, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\\u00a0/g, ' ')).filter(Boolean).join('|')")
    const bytes = (/** @type {string} */ name) => fs.readFileSync(path.join(root, name)).toString('hex')
    const open = async (/** @type {string} */ name) => {
      await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
      await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes(name), 3000)
      await waitFor(async () => (await editorText()).length > 0, 3000)
      await js("document.querySelector('#editor textarea').focus(); undefined")
      await sleep(400)
    }
    const statusMenu = async (/** @type {string} */ item, /** @type {string} */ encoding) => {
      await js("document.getElementById('st-enc').click()")
      await sleep(250)
      await js(`[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === ${JSON.stringify(item)}).click()`)
      await waitFor(() => js("!document.getElementById('quick').hidden"), 3000)
      await sleep(300)
      await type(encoding)
      await sleep(400)
      key('Enter')
      await sleep(600)
    }

    // Files in encodings other than UTF-8, written before the project is opened.
    fs.writeFileSync(path.join(root, 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])) // "café" in Windows-1252
    fs.writeFileSync(path.join(root, 'utf16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi ş\n', 'utf16le')]))
    fs.writeFileSync(path.join(root, 'turkish.txt'), Buffer.from([0x72, 0xfd, 0x6c, 0x0a])) // "rıl" in Windows-1254 ("rýl" if read as 1252)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('latin.txt'), 5000)

    // ---- Detected and preserved ----
    await open('latin.txt')
    check('a Latin-1 file is read correctly, not as garbage', (await editorText()) === 'café', await editorText())
    check('and the status bar says so', (await text('st-enc')) === 'Windows-1252', await text('st-enc'))
    key('Home', ['control'])
    await type('X')
    key('S', ['control'])
    check('saving writes it back in the same encoding', !!(await waitFor(() => bytes('latin.txt') === '58636166e90a', 3000)), bytes('latin.txt'))

    await open('utf16.txt')
    check('a UTF-16 file is detected', (await text('st-enc')) === 'UTF-16 LE' && (await editorText()) === 'hi ş', `${await text('st-enc')} / ${await editorText()}`)
    key('Home', ['control'])
    await type('Y')
    key('S', ['control'])
    await sleep(600)
    check('and saved as UTF-16 with its BOM', bytes('utf16.txt').startsWith('fffe') && Buffer.from(bytes('utf16.txt'), 'hex').subarray(2).toString('utf16le') === 'Yhi ş\n', bytes('utf16.txt'))

    await open('plain.txt')
    check('plain ASCII is UTF-8', (await text('st-enc')) === 'UTF-8')

    // ---- Convert ----
    await open('latin.txt')
    await statusMenu('Save in Encoding…', 'UTF-8')
    check('Save in Encoding converts the file on disk', !!(await waitFor(() => bytes('latin.txt') === '58636166c3a90a', 4000)), bytes('latin.txt'))
    check('and the status bar follows', !!(await waitFor(async () => (await text('st-enc')) === 'UTF-8', 3000)), await text('st-enc'))

    // ---- Text that does not fit is refused, nothing is lost ----
    await open('euro.txt')
    const before = bytes('euro.txt')
    await statusMenu('Save in Encoding…', 'ISO-8859-1')
    check('text the encoding cannot hold is refused, naming the character', !!(await waitFor(async () => (await text('log')).includes('U+20AC'), 4000)), (await text('log')).slice(-200))
    check('the file is untouched and still UTF-8', bytes('euro.txt') === before && (await text('st-enc')) === 'UTF-8', `${bytes('euro.txt')} ${await text('st-enc')}`)

    // ---- Wrong guess: reload in another encoding ----
    await open('turkish.txt')
    check('a guess can be wrong (Windows-1252 reads it as rýl)', (await editorText()) === 'rýl', await editorText())
    await statusMenu('Reload in Encoding…', 'Windows-1254')
    check('Reload in Encoding re-reads the same bytes', !!(await waitFor(async () => (await editorText()) === 'rıl' && (await text('st-enc')) === 'Windows-1254', 4000)), `${await editorText()} / ${await text('st-enc')}`)
  }
)
