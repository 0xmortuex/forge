// @ts-check
// Layout presets: save the current arrangement of tool windows under a name, apply it later (or a built-in one), delete it.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('layout-presets', { 'a.txt': 'x\n' }, async (t) => {
  const { js, key, type, enter, check, sleep, waitFor, userData } = t
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
  const choose = async (/** @type {string} */ name) => {
    await waitFor(() => js("!document.getElementById('quick').hidden"), 3000)
    await type(name)
    await sleep(300)
    key('Enter')
    await sleep(500)
  }
  const saved = () => {
    const file = path.join(userData, 'state.json')
    return fs.existsSync(file) ? Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).layoutPresets ?? {}) : []
  }

  key('O', ['control'])
  await waitFor(() => js("document.getElementById('tree').textContent.includes('a.txt')"), 5000)

  // Arrange something recognisable: Structure moved to the bottom dock, a wide Project panel.
  await js("document.querySelector('.tw-btn[data-win=\"structure\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 200 }))")
  await sleep(150)
  await js("[...document.querySelectorAll('#ctx .ctx-item')].find(i => i.textContent.includes('Bottom')).click()")
  await sleep(300)
  await js("document.getElementById('project').style.width = '480px'")

  await runPalette('Save Layout As')
  await waitFor(() => js("!document.getElementById('ask').hidden"), 3000)
  await type('Mine')
  enter()
  check('Save Layout As remembers the arrangement', !!(await waitFor(() => saved().includes('Mine'), 4000)), JSON.stringify(saved()))

  await runPalette('Reset Layout')
  check('Reset Layout puts everything back', !!(await waitFor(() => js("document.getElementById('project').style.width === ''"), 3000)))

  await runPalette('Apply Layout')
  const items = await waitFor(async () => {
    const list = await js("[...document.querySelectorAll('#quick-results > *')].map(r => r.textContent)")
    return list.length >= 5 ? list : null
  }, 3000)
  const text = JSON.stringify(items)
  check('Apply Layout lists the built-in layouts and the saved one', !!items && ['Default', 'Editor Only', 'Wide Editor', 'Review', 'Mine'].every((n) => text.includes(n)), text)
  await choose('Mine')
  check('applying the saved layout restores the width', !!(await waitFor(() => js("document.getElementById('project').style.width === '480px'"), 3000)))
  check('and where Structure lives', !!(await waitFor(async () => (await parentOf('view-structure')) !== 'right', 3000)), await parentOf('view-structure'))

  await runPalette('Apply Layout')
  await choose('Editor Only')
  check('Editor Only hides every tool window', !!(await waitFor(async () => (await hidden('project')) && (await hidden('bottom')), 3000)))

  await runPalette('Apply Layout')
  await choose('Default')
  check('Default brings Project and Output back', !!(await waitFor(async () => !(await hidden('project')) && !(await hidden('view-output')), 3000)))

  await runPalette('Delete Saved Layout')
  await choose('Mine')
  check('Delete Saved Layout forgets it', !!(await waitFor(() => !saved().includes('Mine'), 4000)), JSON.stringify(saved()))
})
