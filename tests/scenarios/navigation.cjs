// @ts-check
// Navigation: Back/Forward, Recent Files, Recent Locations, and Bookmarks (gutter star, window, popup, persistence).
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

const lines = (/** @type {string} */ name) => Array.from({ length: 60 }, (_, i) => `${name} line ${i + 1}`).join('\n') + '\n'

run(
  'navigation',
  { 'a.txt': lines('a'), 'b.txt': lines('b'), 'c.txt': lines('c') },
  async (t) => {
    const { js, key, type, enter, check, sleep, waitFor, userData } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const openNode = (/** @type {string} */ name) => js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)
    const activeTab = () => js("document.querySelector('.tab.active')?.textContent ?? ''")
    const pos = () => text('st-pos')
    const quickOpen = () => js("!document.getElementById('quick').hidden")
    const quickRows = () => js("[...document.querySelectorAll('#quick-results .result')].map(r => r.textContent).join('|')")
    const state = () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'))
      } catch {
        return {}
      }
    }
    const backDisabled = () => js("document.getElementById('nav-back').disabled")
    const forwardDisabled = () => js("document.getElementById('nav-forward').disabled")

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('a.txt'), 5000)

    // ---- Back / Forward ----
    check('Back and Forward start disabled', (await backDisabled()) && (await forwardDisabled()))
    await openNode('a.txt')
    await openNode('b.txt')
    await openNode('c.txt')
    await waitFor(async () => (await activeTab()).includes('c.txt'), 3000)
    check('after visiting three files Back is enabled, Forward is not', !(await backDisabled()) && (await forwardDisabled()))
    await js("document.getElementById('nav-back').click()")
    check('Back goes to the previous file', !!(await waitFor(async () => (await activeTab()).includes('b.txt'), 3000)), await activeTab())
    key('Left', ['control', 'alt'])
    check('Ctrl+Alt+Left goes back again', !!(await waitFor(async () => (await activeTab()).includes('a.txt'), 3000)), await activeTab())
    key('Right', ['control', 'alt'])
    check('Ctrl+Alt+Right goes forward', !!(await waitFor(async () => (await activeTab()).includes('b.txt'), 3000)), await activeTab())
    check('Forward is now enabled', !(await forwardDisabled()))

    // A long jump inside a file is a place of its own; a short move is not.
    await openNode('c.txt')
    await waitFor(async () => (await activeTab()).includes('c.txt'), 3000)
    key('Home', ['control'])
    for (let i = 0; i < 3; i++) key('Down')
    key('End', ['control'])
    await waitFor(async () => (await pos()).startsWith('61:'), 3000)
    key('Left', ['control', 'alt'])
    check('Back returns to where a long jump started', !!(await waitFor(async () => (await pos()).startsWith('4:'), 3000)), await pos())
    key('Right', ['control', 'alt'])
    check('...and Forward to where it ended', !!(await waitFor(async () => (await pos()).startsWith('61:'), 3000)), await pos())

    // ---- Recent Files ----
    key('E', ['control'])
    check('Ctrl+E opens Recent Files', !!(await waitFor(quickOpen, 2000)))
    check('the most recent file is listed first', (await quickRows()).startsWith('c.txt'), await quickRows())
    check('...with the others after it', (await quickRows()).includes('b.txt') && (await quickRows()).includes('a.txt'), await quickRows())
    key('Enter')
    check('Enter takes you to the previously used file', !!(await waitFor(async () => (await activeTab()).includes('b.txt'), 3000)), await activeTab())
    key('E', ['control'])
    await waitFor(quickOpen, 2000)
    await type('a.t')
    await sleep(200)
    check('typing filters the list', (await quickRows()) === 'a.txt', await quickRows())
    key('Escape')
    check('Escape closes it', !!(await waitFor(async () => !(await quickOpen()), 2000)))

    // ---- Recent Locations ----
    key('E', ['control', 'shift'])
    await waitFor(quickOpen, 2000)
    check('Ctrl+Shift+E lists places, with the text of the line', (await quickRows()).includes('c line 61') || (await quickRows()).includes('line'), await quickRows())
    key('Escape')

    // ---- Bookmarks ----
    await openNode('b.txt')
    await waitFor(async () => (await activeTab()).includes('b.txt'), 3000)
    key('Home', ['control'])
    for (let i = 0; i < 4; i++) key('Down')
    key('F11', ['control'])
    check('Ctrl+F11 puts a star in the gutter', !!(await waitFor(() => js("document.querySelectorAll('.bookmark-glyph').length === 1"), 3000)))
    check('the Bookmarks window carries a badge with the count', !!(await waitFor(async () => (await js("document.querySelector('.tw-btn[data-win=\"bookmarks\"] .badge')?.textContent")) === '1', 3000)))
    await openNode('a.txt')
    await waitFor(async () => (await activeTab()).includes('a.txt'), 3000)
    key('Home', ['control'])
    for (let i = 0; i < 19; i++) key('Down')
    key('F11', ['control'])
    check('a second bookmark in another file', !!(await waitFor(async () => (await js("document.querySelector('.tw-btn[data-win=\"bookmarks\"] .badge')?.textContent")) === '2', 3000)))
    check('both are saved in state.json', !!(await waitFor(() => (state().bookmarks ?? []).length === 2, 4000)), JSON.stringify(state().bookmarks))

    await js("document.querySelector('.tw-btn[data-win=\"bookmarks\"]').click()")
    check('the Bookmarks window lists them', !!(await waitFor(async () => (await js("document.querySelectorAll('#view-bookmarks .bm').length")) === 2, 3000)), await text('view-bookmarks'))
    check('...with the text of each line', (await text('view-bookmarks')).includes('b line 5') && (await text('view-bookmarks')).includes('a line 20'), await text('view-bookmarks'))
    await js("[...document.querySelectorAll('#view-bookmarks .bm')].find(r => r.textContent.includes('b.txt')).click()")
    check('clicking one opens the file at that line', !!(await waitFor(async () => (await activeTab()).includes('b.txt') && (await pos()).startsWith('5:'), 4000)), `${await activeTab()} ${await pos()}`)

    key('F11', ['shift'])
    await waitFor(quickOpen, 2000)
    check('Shift+F11 lists them in a popup', (await quickRows()).includes('b line 5') && (await quickRows()).includes('a line 20'), await quickRows())
    key('Escape')

    // A bookmark follows its line when text is inserted above it.
    key('Home', ['control'])
    enter()
    check('inserting a line above moves the bookmark down with its text', !!(await waitFor(() => js("[...document.querySelectorAll('#view-bookmarks .bm')].some(r => r.dataset.line === '6' && r.textContent.includes('b line 5'))"), 3000)), await text('view-bookmarks'))
    key('Z', ['control']) // undo the insertion

    // Toggling on the bookmarked line removes it.
    await js("[...document.querySelectorAll('#view-bookmarks .bm')].find(r => r.textContent.includes('b.txt')).click()")
    await waitFor(async () => (await pos()).startsWith('5:'), 3000)
    key('F11', ['control'])
    check('Ctrl+F11 on a bookmarked line removes it', !!(await waitFor(async () => (await js("document.querySelectorAll('#view-bookmarks .bm').length")) === 1, 3000)))
    check('...and the saved list shrinks', !!(await waitFor(() => (state().bookmarks ?? []).length === 1, 4000)), JSON.stringify(state().bookmarks))
  }
)
