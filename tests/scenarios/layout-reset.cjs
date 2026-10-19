// @ts-check
// Reset Layout: windows return to their original docks, hidden docks reappear, and custom sizes are dropped.
const { run } = require('../harness.cjs')

run(
  'layout-reset',
  { 'a.txt': 'x\n' },
  async (t) => {
    const { js, key, type, check, sleep, waitFor } = t
    const hidden = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).hidden`)
    const parentOf = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).parentElement.id`)
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await type(query)
      await sleep(300)
      key('Enter')
      await sleep(400)
    }

    key('O', ['control'])
    await waitFor(() => js("document.getElementById('tree').textContent.includes('a.txt')"), 5000)

    // Mess the layout up: Structure to the bottom dock, a wide Project panel, the bottom dock hidden.
    await js("document.querySelector('.tw-btn[data-win=\"structure\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 200 }))")
    await sleep(150)
    await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.includes('Bottom')).click()")
    await sleep(300)
    await js("document.getElementById('project').style.width = '480px'")
    check('Structure now lives in the bottom dock', !!(await waitFor(async () => (await parentOf('view-structure')) !== 'right', 2000)), await parentOf('view-structure'))

    await runPalette('Reset Layout')
    check('Structure is back in the right dock', !!(await waitFor(() => js("!!document.querySelector('#stripe-right .tw-btn[data-win=\"structure\"]')"), 3000)))
    check('the custom Project width is gone', !!(await waitFor(() => js("document.getElementById('project').style.width === ''"), 2000)))
    check('Project and Output are showing', !(await hidden('project')) && !(await hidden('view-output')))
  }
)
