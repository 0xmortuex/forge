// @ts-check
// Debugger: conditional breakpoints, logpoints, disabling, the Breakpoints window, watches, and persistence.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'debug-bp',
  {
    'prog.js': ['let total = 0', 'for (let i = 0; i < 5; i++) {', '  total += i', "  console.log('i=' + i)", '}', "console.log('done total=' + total)", ''].join('\n')
  },
  async (t) => {
    const { js, key, type, enter, wc, waitFor, check, sleep, userData } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const status = () => text('dbg-status')
    const runText = () => js("document.querySelector('#run-term .xterm-rows')?.textContent ?? ''")
    const varsText = () => text('dbg-vars')
    const state = () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'))
      } catch {
        return {}
      }
    }
    /** Right-click in the gutter beside `line`, and pick an entry of the menu that opens. */
    const gutterMenu = async (/** @type {number} */ line, /** @type {string} */ label) => {
      const at = await js(`(() => {
        const num = [...document.querySelectorAll('.margin-view-overlays .line-numbers')].find(n => n.textContent === '${line}')
        const r = num.getBoundingClientRect()
        const ed = document.querySelector('#editor .monaco-editor').getBoundingClientRect()
        return { x: Math.round(ed.left + 8), y: Math.round(r.top + r.height / 2) }
      })()`)
      await js(`document.querySelector('#editor .monaco-editor .margin').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${at.x}, clientY: ${at.y}, button: 2 }))`)
      await sleep(300)
      await js(`[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.startsWith(${JSON.stringify(label)})).click()`)
      await sleep(300)
    }
    const answer = async (/** @type {string} */ value) => {
      await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
      await js("document.getElementById('ask-input').select(); undefined")
      await type(value)
      enter()
      await sleep(400)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('prog.js'), 5000)
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'prog.js').click()")
    await waitFor(async () => (await text('tabs')).includes('prog.js'), 5000)
    await sleep(600)

    // ---- set them from the gutter's context menu ----
    await gutterMenu(3, 'Add Conditional Breakpoint')
    await answer('i === 3')
    await gutterMenu(4, 'Add Logpoint')
    await answer('val {i}')
    check('a conditional breakpoint and a logpoint are drawn differently', !!(await waitFor(async () => (await js("document.querySelectorAll('.bp-glyph.bp-cond').length")) === 1 && (await js("document.querySelectorAll('.bp-glyph.bp-log').length")) === 1, 3000)))
    check('they are remembered in state.json', !!(await waitFor(() => (state().breakpoints ?? []).length === 2, 4000)), JSON.stringify(state().breakpoints))

    // ---- watch ----
    await js("document.querySelector('.tw-btn[data-win=\"debug\"]').click()")
    await js("document.getElementById('dbg-watch-input').focus(); undefined")
    await type('total * 10')
    enter()

    // ---- the conditional breakpoint pauses only when i === 3 ----
    key('F9', ['shift'])
    check('the program pauses on the condition', !!(await waitFor(async () => (await status()).startsWith('Paused'), 30000)), await status())
    check('...with i = 3', !!(await waitFor(async () => /i:3/.test(await varsText()), 8000)), await varsText())
    check('the watch is evaluated in the paused frame (0+1+2 = 3, times 10)', !!(await waitFor(async () => (await text('dbg-watch-list')).includes('total * 10') && (await text('dbg-watch-list')).includes('30'), 8000)), await text('dbg-watch-list'))
    key('F9')
    check('resuming lets the program finish', !!(await waitFor(async () => (await status()) === 'Finished', 20000)), await status())
    await js("document.querySelector('.btab[data-win=run]').click()")
    check(
      'the logpoint printed at every iteration without pausing',
      !!(await waitFor(async () => {
        const o = await runText()
        return o.includes('val 0') && o.includes('val 4') && o.includes('done total=10')
      }, 6000)),
      await runText()
    )

    // ---- the Breakpoints window ----
    key('F8', ['control', 'shift'])
    check('the Breakpoints window lists both', !!(await waitFor(async () => (await js("document.querySelectorAll('#bp-list .bprow').length")) === 2, 4000)), await text('bp-list'))
    check('...with their condition and message', (await text('bp-list')).includes('if i === 3') && (await text('bp-list')).includes('val {i}'), await text('bp-list'))
    await js("document.querySelector('#bp-list .bprow input').click()")
    check('unchecking one disables it (hollow marker)', !!(await waitFor(async () => (await js("document.querySelectorAll('.bp-glyph.bp-off').length")) === 1, 3000)))
    check('...and that is saved', !!(await waitFor(() => (state().breakpoints ?? []).some((/** @type {any} */ b) => b.disabled === true), 4000)))

    // With the conditional one off, only the logpoint remains: no pause at all.
    key('F9', ['shift'])
    await waitFor(async () => (await status()) === 'Running', 10000)
    check('a disabled breakpoint does not pause', !!(await waitFor(async () => (await status()) === 'Finished', 20000)), await status())

    // ---- remove all ----
    await js("document.querySelector('#view-breakpoints .btn').click()")
    check('Remove All clears them', !!(await waitFor(async () => (await js("document.querySelectorAll('.bp-glyph').length")) === 0 && (await js("document.querySelectorAll('#bp-list .bprow').length")) === 0, 4000)))
    check('...and the saved list', !!(await waitFor(() => (state().breakpoints ?? []).length === 0, 4000)))
  }
)
