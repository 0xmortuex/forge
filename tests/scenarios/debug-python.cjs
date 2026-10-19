// @ts-check
// Debugger (Python via debugpy): breakpoints, pause, stack, variables, evaluate, stepping, resume, stop.
// Requires `python` on PATH with debugpy installed (uv pip install debugpy).
const { run } = require('../harness.cjs')

run(
  'debug-python',
  {
    'prog.py': [
      'def add(a, b):',
      '    s = a + b',
      '    return s',
      '',
      'items = [1, 2, 3]',
      'total = add(items[0], 20)',
      "print('total=' + str(total))",
      "print('done')",
      ''
    ].join('\n')
  },
  async (t) => {
    const { js, key, type, enter, wc, waitFor, check, sleep } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const runText = () => js("document.querySelector('#run-term .xterm-rows')?.textContent ?? ''")
    const status = () => text('dbg-status')
    const bpCount = () => js("document.querySelectorAll('.bp-glyph').length")
    const topFrame = () => js("document.querySelector('#dbg-frames .frame')?.textContent ?? ''")
    const varsText = () => js("document.getElementById('dbg-vars').textContent")
    const paused = (/** @type {string} */ where) =>
      waitFor(async () => (await status()).startsWith('Paused') && (await topFrame()).includes(where), 40000)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('prog.py'), 5000)
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'prog.py').click()")
    await waitFor(async () => (await text('tabs')).includes('prog.py'), 5000)
    await sleep(500)

    // Breakpoint with a real mouse click in the gutter, at line 2
    const target = await js(`(() => {
      const num = [...document.querySelectorAll('.margin-view-overlays .line-numbers')].find(n => n.textContent === '2')
      const r = num.getBoundingClientRect()
      const ed = document.querySelector('#editor .monaco-editor').getBoundingClientRect()
      return { x: Math.round(ed.left + 8), y: Math.round(r.top + r.height / 2) }
    })()`)
    for (const type_ of ['mouseDown', 'mouseUp']) {
      wc.sendInputEvent({ type: /** @type {any} */ (type_), x: target.x, y: target.y, button: 'left', clickCount: 1 })
    }
    check('clicking the gutter sets a breakpoint', !!(await waitFor(async () => (await bpCount()) === 1, 3000)))

    key('F9', ['shift'])
    check('Shift+F9 pauses at the breakpoint inside add()', !!(await paused('add')), `${await status()} / ${await topFrame()}`)
    check('top frame is add() at line 2', (await topFrame()).includes('prog.py:2'), await topFrame())
    check('the paused line is highlighted in the editor', !!(await waitFor(() => js("document.querySelectorAll('.debug-line').length > 0"), 3000)))
    check(
      'local variables show a = 1 and b = 20',
      !!(await waitFor(async () => {
        const v = await varsText()
        return /a:1/.test(v) && /b:20/.test(v)
      }, 8000)),
      await varsText()
    )

    await js("document.getElementById('dbg-input').focus(); undefined")
    await type('a + b')
    enter()
    check('evaluate: a + b = 21', !!(await waitFor(async () => (await text('dbg-log')).includes('21'), 5000)), await text('dbg-log'))
    await type('nope.x')
    enter()
    check(
      'evaluate: a Python NameError is shown, not swallowed',
      !!(await waitFor(async () => (await text('dbg-log')).includes('NameError'), 5000)),
      await text('dbg-log')
    )

    key('F8')
    check('F8 steps over to line 3', !!(await waitFor(async () => (await topFrame()).includes('prog.py:3'), 8000)), await topFrame())
    check('s = 21 after the step', !!(await waitFor(async () => /s:21/.test(await varsText()), 8000)), await varsText())
    await t.shot('debug-python-paused.png')

    // Call stack: the module frame, then expand the list
    await js("document.querySelectorAll('#dbg-frames .frame')[1].click()")
    check('the module frame lists items', !!(await waitFor(async () => (await varsText()).includes('items'), 8000)), await varsText())
    await js("[...document.querySelectorAll('#dbg-vars .var')].find(r => r.textContent.startsWith('items')).click()")
    check(
      'expanding items shows its elements',
      !!(await waitFor(async () => /0:1/.test(await varsText()) && /2:3/.test(await varsText()), 8000)),
      await varsText()
    )

    key('F9')
    check('F9 resumes and the program finishes', !!(await waitFor(async () => (await status()) === 'Finished', 20000)), await status())
    await js("document.querySelector('.btab[data-win=run]').click()") // xterm only renders while visible
    check(
      'program output reached the Run tab',
      !!(await waitFor(async () => (await runText()).includes('total=21') && (await runText()).includes('done'), 5000))
    )
    check('paused-line highlight is cleared', (await js("document.querySelectorAll('.debug-line').length")) === 0)
    check('Run is enabled again', !!(await waitFor(() => js("!document.getElementById('run-btn').disabled"), 5000)))

    // Remove the breakpoint: the next debug run must not pause
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('Home', ['control'])
    key('Down')
    key('F8', ['control'])
    check('Ctrl+F8 toggles the breakpoint off', !!(await waitFor(async () => (await bpCount()) === 0, 3000)))
    key('F9', ['shift'])
    await waitFor(async () => (await status()) === 'Running', 15000)
    check('without breakpoints the program just runs to completion', !!(await waitFor(async () => (await status()) === 'Finished', 25000)), await status())
    await waitFor(() => js("!document.getElementById('run-btn').disabled"), 10000)

    // Stop while paused
    key('F8', ['control'])
    await waitFor(async () => (await bpCount()) === 1, 3000)
    key('F9', ['shift'])
    check('a new session pauses at the restored breakpoint', !!(await paused('add')), `${await status()} / ${await topFrame()}`)
    key('F2', ['control'])
    check('Ctrl+F2 stops a paused session', !!(await waitFor(async () => (await status()) === 'Finished', 15000)), await status())
  }
)
