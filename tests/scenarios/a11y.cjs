// @ts-check
// Accessibility audit of Forge's own interface (not Monaco's): with every tool window opened, every control a person can
// operate has a name a screen reader can say, dialogs are announced as dialogs, and nothing focusable is hidden from
// the keyboard.
const { run } = require('../harness.cjs')

const NAME_PROBE = `(() => {
  const named = (el) => {
    const label = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')
    if (label && label.trim()) return true
    if (el.id && document.querySelector('label[for="' + el.id + '"]')) return true
    if (el.closest('label') && el.closest('label').textContent.trim()) return true
    if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.placeholder && el.placeholder.trim()) return true
    if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return false
    return !!el.textContent.trim()
  }
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const skip = (el) => el.closest('.monaco-editor, .xterm, .monaco-diff-editor, .monaco-hover') || el.classList.contains('xterm-helper-textarea') || el.classList.contains('inputarea') || el.tagName === 'TEXTAREA' && el.closest('.monaco-editor, .xterm')
  const out = []
  for (const el of document.querySelectorAll('button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], a[href]')) {
    if (skip(el) || !visible(el)) continue
    if (!named(el)) out.push((el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')))
  }
  return [...new Set(out)]
})()`

run('a11y', { 'a.ts': 'export const a = 1\n', 'data.csv': 'a,b\n1,2\n' }, async (t) => {
  const { js, key, check, sleep, waitFor } = t
  const WINDOWS = ['project', 'commit', 'output', 'terminal', 'find', 'run', 'debug', 'problems', 'structure', 'bookmarks', 'hierarchy', 'git', 'todo', 'preview', 'breakpoints', 'http', 'ai', 'database', 'duplicates', 'npm', 'tests', 'viewer', 'github', 'docker']

  const offenders = new Set()
  // The welcome screen, before any project is open.
  for (const o of await js(NAME_PROBE)) offenders.add('welcome: ' + o)

  key('O', ['control'])
  await waitFor(() => js("document.getElementById('tree').textContent.includes('a.ts')"), 5000)

  // The welcome screen is gone once a project is open; look at the main window and each tool window in turn.
  for (const id of WINDOWS) {
    await js(`(() => { const b = document.querySelector('.tw-btn[data-win="${id}"]'); if (b) b.click() })()`)
    await sleep(250)
    for (const o of await js(NAME_PROBE)) offenders.add(o)
  }
  // Every page of Settings.
  key(',', ['control'])
  await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
  const pages = await js("[...document.querySelectorAll('.snav')].map(n => n.dataset.cat)")
  for (const cat of pages) {
    await js(`document.querySelector('.snav[data-cat="${cat}"]').click()`)
    await sleep(350)
    for (const o of await js(NAME_PROBE)) offenders.add(`settings/${cat}: ${o}`)
  }
  check('Settings has pages to audit', pages.length >= 8, String(pages.length))
  await js("document.getElementById('settings-close').click()")

  const unnamed = [...offenders]
  check('every visible control has an accessible name', unnamed.length === 0, unnamed.join(', '))

  // The status bar widgets are clickable: they need to be reachable and named.
  const statusWidgets = await js("[...document.querySelectorAll('#status .sw')].filter(e => e.onclick).map(e => e.id + ':' + (e.getAttribute('role') || '') + ':' + (e.tabIndex))")
  check('clickable status-bar widgets are focusable buttons', statusWidgets.every((/** @type {string} */ w) => w.includes(':button:') && !w.endsWith(':-1')), statusWidgets.join(' | '))

  // Dialogs
  const dialogs = await js("['palette', 'search', 'quick', 'ask', 'settings'].map(id => { const el = document.getElementById(id); const box = el && (el.querySelector('.modal') || el); return id + ':' + (box && box.getAttribute('role')) + ':' + (box && box.getAttribute('aria-modal')) })")
  check('dialogs are announced as dialogs', dialogs.every((/** @type {string} */ d) => d.includes(':dialog:')), dialogs.join(' | '))

  // Landmarks and live regions
  check('the status message is a polite live region', (await js("document.getElementById('status-msg').getAttribute('aria-live')")) === 'polite')
  check('the page declares its language', (await js('document.documentElement.lang')) !== '')
  check('the tool-window stripes are labelled navigation', (await js("['stripe', 'stripe-right'].every(id => { const e = document.getElementById(id); return !e || e.getAttribute('aria-label') })")) === true)
})
