// @ts-check
// Tool-window docks: a right dock, moving windows between docks (menu and drag), and the layout surviving a restart.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'docks',
  { 'a.txt': 'x\n' },
  async (t) => {
    const { js, key, waitFor, check, sleep, userData } = t
    const hidden = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).hidden`)
    const parentOf = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).parentElement.id`)
    const stripeIds = (/** @type {string} */ id) => js(`[...document.querySelectorAll('#${id} .tw-btn')].map(b => b.dataset.win).join(',')`)
    const state = () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'))
      } catch {
        return {}
      }
    }
    // Opens a stripe button's context menu and clicks an entry.
    const menu = async (/** @type {string} */ win, /** @type {string} */ label) => {
      await js(`document.querySelector('.tw-btn[data-win="${win}"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 200 }))`)
      await sleep(150)
      await js(`[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent === ${JSON.stringify(label)}).click()`)
      await sleep(250)
    }

    key('O', ['control'])
    await waitFor(() => js("document.getElementById('tree').textContent.includes('a.txt')"), 5000)

    check('the right dock starts closed', await hidden('right'))
    check('the right stripe has Structure and Bookmarks', (await stripeIds('stripe-right')) === 'structure,preview,bookmarks,ai', await stripeIds('stripe-right'))
    check('the left stripe has Project and Commit on top', (await stripeIds('stripe-left-top')) === 'project,commit', await stripeIds('stripe-left-top'))
    check(
      'the bottom windows are below, nearest the edge first',
      (await stripeIds('stripe-left-bottom')) === 'hierarchy,problems,git,todo,http,breakpoints,debug,run,find,terminal,output',
      await stripeIds('stripe-left-bottom')
    )

    key('7', ['alt'])
    check('Alt+7 opens Structure in the right dock', !!(await waitFor(async () => !(await hidden('right')) && !(await hidden('view-structure')), 2000)))
    key('7', ['alt'])
    check('Alt+7 closes it again', !!(await waitFor(() => hidden('right'), 2000)))
    key('6', ['alt'])
    check('Alt+6 opens Problems at the bottom', !!(await waitFor(async () => !(await hidden('view-problems')) && !(await hidden('bottom')), 2000)))

    // ---- moving a window with its context menu ----
    await menu('problems', 'Move to Right')
    check('Problems moved into the right dock', (await parentOf('view-problems')) === 'right', await parentOf('view-problems'))
    check('...which opened', !(await hidden('right')) && !(await hidden('view-problems')))
    check('...and its stripe button moved to the right stripe', (await stripeIds('stripe-right')) === 'problems,structure,preview,bookmarks,ai', await stripeIds('stripe-right'))
    check('...and left the bottom tabs', !(await js("[...document.querySelectorAll('#bottom-tabs .btab')].some(b => b.dataset.win === 'problems')")))
    await js("document.querySelector('#right-tabs .btab[data-win=\"structure\"]').click()")
    check('the right dock switches windows with its tabs', !(await hidden('view-structure')) && (await hidden('view-problems')))

    // ---- the layout is remembered ----
    check(
      'the new placement is saved to state.json',
      !!(await waitFor(() => state().layout?.docks?.problems === 'right' && state().layout?.rightHidden === false, 4000)),
      JSON.stringify(state().layout)
    )

    // ---- moving by dragging a stripe button ----
    await js(`(() => {
      const dt = new DataTransfer()
      document.querySelector('.tw-btn[data-win="problems"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      const stripe = document.getElementById('stripe')
      const box = stripe.getBoundingClientRect()
      stripe.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 5, clientY: box.bottom - 5 }))
    })()`)
    await sleep(300)
    check('dropping on the lower half of the left stripe moves a window to the bottom', (await parentOf('view-problems')) === 'bottom', await parentOf('view-problems'))
    await js(`(() => {
      const dt = new DataTransfer()
      document.querySelector('.tw-btn[data-win="terminal"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
      const stripe = document.getElementById('stripe')
      const box = stripe.getBoundingClientRect()
      stripe.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 5, clientY: box.top + 5 }))
    })()`)
    await sleep(300)
    check('dropping on the upper half moves it to the left dock', (await parentOf('view-terminal')) === 'project', await parentOf('view-terminal'))
    await menu('terminal', 'Move to Bottom')
    check('and the menu moves it back', (await parentOf('view-terminal')) === 'bottom')

    // ---- an emptied dock disappears ----
    await menu('problems', 'Move to Right')
    await menu('structure', 'Move to Left')
    await menu('bookmarks', 'Move to Left')
    await menu('preview', 'Move to Left')
    await menu('ai', 'Move to Left')
    await menu('problems', 'Move to Left')
    check('a dock with no windows is hidden', await hidden('right'))
    check('...along with its stripe', await js("document.getElementById('stripe-right').hidden"))
    check('windows moved left show in the left dock', (await parentOf('view-structure')) === 'project' && (await parentOf('view-problems')) === 'project')

    // ---- hiding ----
    await js("document.querySelector('#project [data-hide]').click()")
    check('the hide button closes the dock', !!(await waitFor(() => hidden('project'), 2000)))
    key('1', ['alt'])
    check('Alt+1 brings it back, even though the terminal has focus', !!(await waitFor(async () => !(await hidden('project')), 2000)), JSON.stringify(state().layout))
  }
)
