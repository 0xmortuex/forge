// @ts-check
// Run configurations: node / python / command, Stop, interactive stdin, auto-save, config picker, errors.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')

run(
  'run',
  {
    'hello.js': "console.log('hello from node')\n",
    'hello.py': "print('py ok')\n",
    'loop.js': "console.log('loop started')\nsetInterval(() => {}, 1000)\n",
    'ask.js': "console.log('say something')\nprocess.stdin.once('data', (d) => { console.log('got:' + d.toString().trim()); process.exit(0) })\n",
    'notes.txt': 'not runnable\n',
    '.forge/run.json': JSON.stringify({
      configurations: [
        { name: 'Current File', type: 'current-file' },
        { name: 'Loop', type: 'node', program: 'loop.js' },
        { name: 'Ask', type: 'node', program: 'ask.js' },
        { name: 'Echo', type: 'command', command: 'echo cmd-ok' }
      ]
    })
  },
  async (t) => {
    const { js, key, type, enter, waitFor, check, root, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const runText = () => js("document.querySelector('#run-term .xterm-rows')?.textContent ?? ''")
    const openNode = (/** @type {string} */ name) =>
      js(`[...document.querySelectorAll('.node')].find(n => n.textContent === ${JSON.stringify(name)}).click()`)
    const openFileTab = async (/** @type {string} */ name) => {
      await openNode(name)
      await waitFor(async () => (await text('tabs')).includes(name), 5000)
      await sleep(300)
    }
    const pickConfig = async (/** @type {string} */ name) => {
      await js("document.getElementById('run-config').click()")
      await waitFor(() => js("document.querySelectorAll('.ctx-item').length > 0"), 3000)
      await js(`[...document.querySelectorAll('.ctx-item')].find(i => i.textContent.includes(${JSON.stringify(name)})).click()`)
    }
    const runBtnEnabled = () => js("!document.getElementById('run-btn').disabled")
    const stopBtnEnabled = () => js("!document.getElementById('stop-btn').disabled")

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('hello.js'), 5000)

    // Node: current file
    await openFileTab('hello.js')
    key('F10', ['shift'])
    check('Shift+F10 runs the current JS file', !!(await waitFor(async () => (await runText()).includes('hello from node'), 20000)))
    check('Run tab is shown', await js("!document.getElementById('view-run').hidden"))
    check('exit code is reported', !!(await waitFor(async () => (await runText()).includes('exit code 0'), 10000)))
    check('Run re-enabled and Stop disabled after exit', !!(await waitFor(async () => (await runBtnEnabled()) && !(await stopBtnEnabled()), 5000)))

    // Python: current file
    await openFileTab('hello.py')
    key('F10', ['shift'])
    check('current-file runs a Python file', !!(await waitFor(async () => (await runText()).includes('py ok'), 20000)))
    await waitFor(runBtnEnabled, 10000)

    // Auto-save: an unsaved edit must be what runs
    await openFileTab('hello.js')
    key('End', ['control'])
    await type("console.log('SAVED-EDIT')")
    key('F10', ['shift'])
    check('unsaved edits are saved and run', !!(await waitFor(async () => (await runText()).includes('SAVED-EDIT'), 20000)))
    check('the file on disk has the edit', fs.readFileSync(path.join(root, 'hello.js'), 'utf8').includes('SAVED-EDIT'))
    await waitFor(runBtnEnabled, 10000)

    // Config picker + Stop on a long-running process
    await pickConfig('Loop')
    check('picker switches the selected configuration', (await text('run-config-name')) === 'Loop')
    await js("document.getElementById('run-btn').click()")
    check('a long-running process starts', !!(await waitFor(async () => (await runText()).includes('loop started'), 20000)))
    check('Stop is enabled while it runs', !!(await waitFor(stopBtnEnabled, 3000)))
    key('F2', ['control'])
    check('Ctrl+F2 stops it', !!(await waitFor(async () => !(await stopBtnEnabled()) && (await runBtnEnabled()), 8000)))

    // Interactive stdin
    await pickConfig('Ask')
    await js("document.getElementById('run-btn').click()")
    await waitFor(async () => (await runText()).includes('say something'), 20000)
    await js("document.querySelector('#run-term .xterm-helper-textarea').focus(); undefined")
    await type('abc')
    enter()
    check('typed input reaches the running program', !!(await waitFor(async () => (await runText()).includes('got:abc'), 10000)))
    await waitFor(runBtnEnabled, 10000)

    // Shell command configuration
    await pickConfig('Echo')
    await js("document.getElementById('run-btn').click()")
    check('command configurations run through the shell', !!(await waitFor(async () => (await runText()).includes('cmd-ok'), 20000)))
    await waitFor(runBtnEnabled, 10000)

    // Errors are reported, never silent
    await pickConfig('Current File')
    await openFileTab('notes.txt')
    key('F10', ['shift'])
    check(
      'unrunnable file type is reported',
      !!(await waitFor(async () => (await text('status-msg')).includes("Don't know how to run .txt"), 5000)),
      await text('status-msg')
    )
    fs.writeFileSync(path.join(root, '.forge', 'run.json'), '{ not json')
    key('F10', ['shift'])
    check(
      'a broken run.json is reported with its file name',
      !!(await waitFor(async () => (await text('status-msg')).includes('run.json is not valid JSON'), 5000)),
      await text('status-msg')
    )
  }
)
