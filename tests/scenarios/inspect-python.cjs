// @ts-check
// Inspect Code on a Python project: pyright checks every file, not just the open ones.
const { run } = require('../harness.cjs')

run(
  'inspect-python',
  {
    'pyproject.toml': '[project]\nname = "demo"\nversion = "0.1.0"\n',
    'ok.py': 'x: int = 1\n',
    'bad.py': 'y: int = "text"\n'
  },
  async (t) => {
    const { js, key, check, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('ok.py'), 5000)
    key('6', ['alt'])
    await waitFor(() => js("!!document.getElementById('problems-inspect')"), 3000)
    await js("document.getElementById('problems-inspect').click()")
    check('pyright reports the file that is not open', !!(await waitFor(async () => (await text('problems-list')).includes('bad.py'), 60000)), await text('problems-list'))
    const list = await text('problems-list')
    check('the section names pyright', list.includes('pyright'), list)
    check('the error is listed with its line', (await js("[...document.querySelectorAll('#problems-list .prob.error')].some(r => r.dataset.line === '1')")) === true, list)
  }
)
