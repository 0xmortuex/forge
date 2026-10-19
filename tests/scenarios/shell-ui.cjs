// @ts-check
// The shell's finishing layer: welcome screen and recent-project cards, the search pill, styled tooltips,
// file-type badges and folder icons, tree indent guides, and the clickable status bar widgets.
const { run } = require('../harness.cjs')

run(
  'shell-ui',
  { 'src/a.ts': 'export const a = 1\n', 'b.py': 'print(1)\n' },
  async (t) => {
    const { js, key, check, sleep, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const visible = (/** @type {string} */ id) => js(`!document.getElementById(${JSON.stringify(id)}).hidden`)
    const node = (/** @type {string} */ name) => `[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)})`
    const menuItems = () => js("[...document.querySelectorAll('#ctx .ctx-item')].map(i => i.textContent).join('|')")
    const pick = async (/** @type {string} */ label) => {
      await js(`[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === ${JSON.stringify(label)}).click()`)
      await sleep(250)
    }

    // ---- welcome screen ----
    check('the welcome screen shows its actions', (await text('welcome')).includes('Open Folder') && (await text('welcome')).includes('Settings & Themes'))
    check('recent projects are cards with an avatar', (await js("document.querySelector('#recents .recent .avatar')?.textContent")) === 'FO', await text('recents'))
    check('...each with its own hue', (await js("document.querySelector('#recents .recent .avatar').style.getPropertyValue('--h')")) !== '')
    await js("document.getElementById('w-search').click()")
    check('"Search Everywhere" on the welcome screen opens the search', await visible('search'))
    key('Escape')
    await js("document.getElementById('w-palette').click()")
    check('"Command Palette" opens the palette', await visible('palette'))
    key('Escape')
    await js("document.getElementById('w-settings').click()")
    check('"Settings & Themes" opens Settings', !!(await waitFor(() => visible('settings'), 3000)))
    await js("document.getElementById('settings-close').click()")
    await js("document.getElementById('search-btn').click()")
    check('the search pill in the toolbar opens the search too', await visible('search'))
    key('Escape')

    // open the project through its recent card
    await js("document.querySelector('#recents .recent').click()")
    await waitFor(async () => (await text('tree')).includes('src'), 5000)

    // ---- file and folder icons ----
    const src = await js(`${node('src')}.querySelector('.ficon').innerHTML`)
    await js(`${node('src')}.click()`)
    await waitFor(async () => (await text('tree')).includes('a.ts'), 3000)
    check('opening a folder draws it open', (await js(`${node('src')}.querySelector('.ficon').innerHTML`)) !== src)
    check('a file shows a type badge', (await js(`${node('a.ts')}.querySelector('.fbadge')?.dataset.l`)) === 'TS')
    check('...whose letters are not part of the row text', (await js(`${node('a.ts')}.textContent`)) === 'a.ts')
    check('the Python file has its own badge', (await js(`${node('b.py')}.querySelector('.fbadge')?.dataset.l`)) === 'PY')
    check('nested rows carry their depth (indent guides)', (await js(`${node('a.ts')}.style.getPropertyValue('--depth')`)) === '1')

    // ---- tooltips ----
    const hover = (/** @type {string} */ sel) => js(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
    await hover('.tw-btn[data-win="project"]')
    check('hovering a button shows a styled tooltip', !!(await waitFor(() => js("!document.getElementById('tooltip').hidden"), 2000)))
    check('...with the label and the shortcut as key caps', (await text('tooltip')).startsWith('Project') && (await js("document.querySelectorAll('#tooltip kbd').length")) === 2, await text('tooltip'))
    check('...replacing the native tooltip', (await js("document.querySelector('.tw-btn[data-win=\"project\"]').hasAttribute('title')")) === false)
    await js("document.querySelector('.tw-btn[data-win=\"project\"]').dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))")
    check('moving away hides it', !!(await waitFor(() => js("document.getElementById('tooltip').hidden"), 1000)))

    // ---- status bar widgets ----
    await js(`${node('a.ts')}.click()`)
    await waitFor(async () => (await text('st-lang')) === 'typescript', 5000)
    await js("document.getElementById('st-eol').click()")
    check('the line-ending widget offers LF and CRLF', (await menuItems()).includes('CRLF'), await menuItems())
    await pick('CRLF (Windows)')
    check('choosing CRLF changes the file', (await text('st-eol')) === 'CRLF', await text('st-eol'))

    await js("document.getElementById('st-indent').click()")
    await pick('4 spaces')
    check('the indentation widget sets the indent size', (await text('st-indent')) === '4 spaces', await text('st-indent'))
    await js("document.getElementById('st-indent').click()")
    await pick('Tabs')
    check('...or switches to tabs', (await text('st-indent')) === 'Tab size 4', await text('st-indent'))

    await js("document.getElementById('st-lang').click()")
    check('the language widget lists languages', (await menuItems()).includes('Python'), await menuItems())
    await pick('Python')
    check('picking one changes the file mode', (await text('st-lang')) === 'python', await text('st-lang'))

    await js("document.getElementById('st-pos').click()")
    check(
      'the position widget opens Go to Line',
      !!(await waitFor(() => js("!!document.querySelector('.quick-input-widget:not([style*=\"display: none\"])')"), 3000))
    )
    key('Escape')
  },
  { userData: { 'state.json': JSON.stringify({ recents: ['{{ROOT}}'] }) } }
)
