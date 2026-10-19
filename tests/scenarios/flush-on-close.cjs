// @ts-check
// Closing the window right after a change must not lose it: pending settings are flushed first (and closing stays quick).
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('flush-on-close', { 'a.txt': 'x\n' }, async (t) => {
  const { key, type, waitFor, check, userData, sleep, js } = t
  const file = path.join(userData, 'settings.json')
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) throw new Error('No window')

  // The harness keeps the process alive after the last window closes, so we can still look at the disk.
  app.removeAllListeners('window-all-closed')

  key('P', ['control', 'shift'])
  await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
  await type('toggle minimap')
  await sleep(250)
  key('Enter') // changes the setting; the page schedules a save ~250 ms later
  const started = Date.now()
  win.close() // ...but we close right away

  let wroteAt = -1
  while (Date.now() - started < 1200) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('"minimap": true')) {
      wroteAt = Date.now() - started
      break
    }
    await sleep(10)
  }
  check('the pending setting reached the disk', wroteAt >= 0, `waited ${Date.now() - started}ms`)
  // The normal save happens ~250 ms after the change. Beating it can only be the flush on close.
  check('...before the normal delayed save could have run (so it was the flush)', wroteAt >= 0 && wroteAt < 230, `wrote after ${wroteAt}ms`)

  const closedBy = await waitFor(() => win.isDestroyed(), 2500)
  check('the window then closes promptly', !!closedBy && Date.now() - started < 2200, `${Date.now() - started}ms`)
})
