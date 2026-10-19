// @ts-check
// The Markdown preview (live, sanitized, relative images and links) and the image viewer.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

// A 1x1 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

run(
  'preview',
  {
    'README.md': '# Title\n\nSome **bold** text and a [other file](other.md).\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n![pic](pic.png)\n\n<script>window.__pwned = 1</script>\n\n## Second part\n',
    'other.md': '# Other\n'
  },
  async (t) => {
    const { js, key, type, check, sleep, waitFor, root } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const node = (/** @type {string} */ name) => `[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)})`
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type(query)
      await sleep(300)
      key('Enter')
      await sleep(300)
    }
    fs.writeFileSync(path.join(root, 'pic.png'), PNG)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('README.md'), 5000)
    await js(`${node('README.md')}.click()`)
    await waitFor(async () => (await text('tabs')).includes('README.md'), 3000)
    await runPalette('toggle markdown preview')
    check('the preview renders the Markdown', !!(await waitFor(async () => (await js("document.querySelector('#md-body h1')?.textContent")) === 'Title', 4000)))
    check('...with bold text and a table', (await js("!!document.querySelector('#md-body strong') && document.querySelectorAll('#md-body td').length === 2")))
    check('headings get ids, so #anchors work', (await js("document.querySelector('#md-body h2')?.id")) === 'second-part')
    check('raw HTML is sanitized: no script survives', !(await js("!!document.querySelector('#md-body script') || window.__pwned === 1")))
    check('a relative image is loaded from disk', !!(await waitFor(async () => (await js("document.querySelector('#md-body img')?.getAttribute('src') ?? ''")).startsWith('data:image/png'), 5000)))

    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('End', ['control'])
    await type('\nA brand new paragraph')
    check('the preview follows the editor as you type', !!(await waitFor(async () => (await text('md-body')).includes('A brand new paragraph'), 4000)))

    await js("[...document.querySelectorAll('#md-body a')].find(a => a.textContent === 'other file').click()")
    check('a link to another Markdown file opens it', !!(await waitFor(async () => (await text('tabs')).includes('other.md'), 4000)))
    check('...and the preview switches to it', !!(await waitFor(async () => (await js("document.querySelector('#md-body h1')?.textContent")) === 'Other', 4000)))

    // ---- images ----
    await js(`${node('pic.png')}.click()`)
    check('an image opens in the viewer', !!(await waitFor(async () => (await js("!document.getElementById('image-view').hidden && document.getElementById('editor').hidden")), 4000)))
    check('...showing the picture with its size', !!(await waitFor(async () => (await text('image-view')).includes('1 × 1') && (await js("document.querySelector('#image-view img').src")).startsWith('data:image/png'), 4000)), await text('image-view'))
    const before = fs.statSync(path.join(root, 'pic.png')).size
    key('S', ['control'])
    await sleep(500)
    check('saving with an image open never touches the file', fs.statSync(path.join(root, 'pic.png')).size === before && fs.readFileSync(path.join(root, 'pic.png')).equals(PNG))
    await js("document.querySelector('.tab').click()")
    check('switching back to a text file brings the editor back', !!(await waitFor(async () => (await js("document.getElementById('image-view').hidden && !document.getElementById('editor').hidden")), 4000)))
  }
)
