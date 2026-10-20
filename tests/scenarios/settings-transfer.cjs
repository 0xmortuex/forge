// @ts-check
// Export/Import Settings (native dialogs stubbed) and Presentation Mode.
const fs = require('node:fs')
const path = require('node:path')
const { dialog } = require('electron')
const { run } = require('../harness.cjs')

run(
  'settings-transfer',
  { 'words.txt': 'foo bar baz\n' },
  async (t) => {
    const { js, key, type, check, sleep, waitFor, root, userData } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const runPalette = async (/** @type {string} */ query) => {
      key('P', ['control', 'shift'])
      await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
      await sleep(400)
      await type(query)
      await sleep(600)
      key('Enter')
      await sleep(400)
    }
    const savedSettings = () => JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))
    const fontPx = () => js("parseFloat(getComputedStyle(document.querySelector('#editor .view-line')).fontSize)")

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('words.txt'), 5000)
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'words.txt').click()")
    await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('words.txt'), 3000)
    await sleep(600)

    // ---- Export ----
    const exported = path.join(root, 'out.json')
    dialog.showSaveDialog = /** @type {any} */ (async () => ({ canceled: false, filePath: exported }))
    await runPalette('Export Settings')
    check('Export writes the file the user picked', !!(await waitFor(() => fs.existsSync(exported), 4000)))
    const out = fs.existsSync(exported) ? JSON.parse(fs.readFileSync(exported, 'utf8')) : {}
    check('it holds the customized settings, including unknown keys', out.fontSize === 17 && out.tabSize === 3 && out['my.custom'] === 'x', JSON.stringify(out))
    check('and says where it went', (await text('log')).includes('Settings exported'))

    // ---- Import ----
    const backup = path.join(root, 'backup.json')
    fs.writeFileSync(backup, JSON.stringify({ fontSize: 21, tabSize: 'wide', wordWrap: 'bogus', 'other.key': 7 }))
    dialog.showOpenDialog = /** @type {any} */ (async () => ({ canceled: false, filePaths: [backup] }))
    await runPalette('Import Settings')
    check('Import applies valid values', !!(await waitFor(() => { try { return savedSettings().fontSize === 21 } catch { return false } }, 4000)), JSON.stringify(savedSettings()))
    const after = savedSettings()
    check('invalid values are skipped, the old ones stay', after.tabSize === 3 && after.wordWrap === undefined, JSON.stringify(after))
    check('unknown keys come along, and existing ones survive', after['other.key'] === 7 && after['my.custom'] === 'x', JSON.stringify(after))
    const log = await text('log')
    check('the skipped values are named, not swallowed', log.includes('Skipped 2 invalid values') && log.includes('tabSize') && log.includes('wordWrap'), log.slice(-250))

    // A file that is not settings is refused with a message.
    fs.writeFileSync(backup, '[1, 2]')
    await runPalette('Import Settings')
    check('a file that is not a settings object is refused', !!(await waitFor(async () => (await text('log')).includes('Not a settings file'), 3000)))

    // ---- Presentation mode ----
    const normal = await fontPx()
    await js("document.querySelector('#editor textarea').focus(); undefined")
    await runPalette('Presentation Mode')
    check('Presentation Mode hides the surroundings', !!(await waitFor(() => js("document.body.classList.contains('presentation') && document.body.classList.contains('zen')"), 3000)))
    check('and enlarges the editor text', !!(await waitFor(async () => (await fontPx()) >= normal * 1.5, 3000)), `${normal} -> ${await fontPx()}`)
    await runPalette('Presentation Mode')
    check('toggling again restores everything', !!(await waitFor(async () => (await fontPx()) === normal && (await js("!document.body.classList.contains('zen')")), 3000)), `${normal} -> ${await fontPx()}`)
  },
  { userData: { 'settings.json': JSON.stringify({ fontSize: 17, tabSize: 3, 'my.custom': 'x' }) } }
)
