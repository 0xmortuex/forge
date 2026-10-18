// @ts-check
// Smoke-test harness. Runs as the Electron main process: `electron tests/scenarios/<name>.cjs`.
// Boots the built app (out/main), stubs the native folder picker to point at a temp fixture project,
// then drives the real UI with key events and reads results from the DOM and the filesystem.
const { app, dialog, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CR = String.fromCharCode(13)
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {string} name
 * @param {Record<string, string>} files  fixture project: relative path -> contents
 * @param {(t: any) => Promise<void>} scenario
 */
async function run(name, files, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  dialog.showOpenDialog = /** @type {any} */ (async () => ({ canceled: false, filePaths: [root] }))
  require('../out/main/index.js')

  /** @type {boolean[]} */
  const results = []
  const check = (/** @type {string} */ label, /** @type {boolean} */ ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${label}${ok ? '' : detail ? ` — ${detail}` : ''}`)
  }

  const watchdog = setTimeout(() => {
    console.log(`FAIL ${name}: timed out after 150s`)
    cleanup(1)
  }, 150000)

  /** @param {number} code */
  async function cleanup(code) {
    clearTimeout(watchdog)
    // quit() (not exit()) so the app's before-quit hook kills terminals and language servers.
    app.quit()
    // Servers use the fixture as their cwd, so it can't be deleted until they're gone.
    await sleep(2000)
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    } catch (err) {
      console.log(`WARN ${name}: could not remove ${root}: ${/** @type {Error} */ (err).message}`)
    }
    process.exit(code)
  }

  await app.whenReady()
  let win = BrowserWindow.getAllWindows()[0]
  while (!win) {
    await sleep(100)
    win = BrowserWindow.getAllWindows()[0]
  }
  const wc = win.webContents
  if (wc.isLoading()) await new Promise((resolve) => wc.once('did-finish-load', () => resolve(undefined)))
  await sleep(1500) // let the renderer finish initializing

  /** Evaluate in the renderer. Must not return functions or DOM nodes. */
  const js = (/** @type {string} */ code) => wc.executeJavaScript(code)
  const key = (/** @type {string} */ keyCode, /** @type {any[]} */ modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }
  const type = async (/** @type {string} */ text) => {
    for (const ch of text) {
      wc.sendInputEvent({ type: 'char', keyCode: ch })
      await sleep(15)
    }
  }
  // keyDown alone inserts no text in Electron; Enter needs a char event as well.
  const enter = () => {
    key('Enter')
    wc.sendInputEvent({ type: 'char', keyCode: CR })
  }
  /** Polls until `fn` returns something truthy; returns it, or null on timeout. */
  const waitFor = async (/** @type {() => any} */ fn, ms = 30000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      const v = await fn()
      if (v) return v
      await sleep(250)
    }
    return null
  }
  const shot = async (/** @type {string} */ file) => {
    if (process.env['SHOTS']) fs.writeFileSync(path.join(process.env['SHOTS'], file), (await wc.capturePage()).toPNG())
  }
  wc.on('console-message', (_e, level, message) => {
    if (level >= 3 && process.env['VERBOSE']) console.log('  [renderer error]', message.slice(0, 200))
  })

  const t = { root, wc, sleep, js, key, type, enter, waitFor, check, shot }
  try {
    await js('window.confirm = () => true; undefined') // native confirm() would block the driver
    await scenario(t)
  } catch (err) {
    check('scenario completed without throwing', false, String(err && /** @type {Error} */ (err).stack))
  }
  const failed = results.filter((r) => !r).length
  console.log(`${failed ? 'FAILED' : 'OK'} ${name}: ${results.length - failed}/${results.length} checks passed`)
  await cleanup(failed ? 1 : 0)
}

module.exports = { run }
