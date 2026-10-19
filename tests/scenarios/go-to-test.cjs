// @ts-check
// Go to Test / Source (Ctrl+Shift+T): jumps between a file and its test by naming convention.
const { run } = require('../harness.cjs')

run(
  'go-to-test',
  {
    'src/calc.ts': 'export const add = (a: number, b: number) => a + b\n',
    'src/calc.test.ts': "import { add } from './calc'\n",
    'util.py': 'def f(): pass\n',
    'test_util.py': 'from util import f\n',
    'lonely.ts': 'export {}\n',
    'multi.ts': 'export {}\n',
    'multi.test.ts': '\n',
    'multi.spec.ts': '\n'
  },
  async (t) => {
    const { js, key, check, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
    const activeTab = () => js("document.querySelector('.tab.active')?.textContent ?? ''")
    const open = async (/** @type {string} */ name) => {
      await js(`[...document.querySelectorAll('.node')].find(x => x.textContent === ${JSON.stringify(name)}).click()`)
      await waitFor(async () => (await activeTab()).includes(name), 3000)
    }

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('util.py'), 5000)
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'src').click()")
    await waitFor(() => js("[...document.querySelectorAll('.node')].some(x => x.textContent === 'calc.ts')"), 3000)

    await open('calc.ts')
    key('T', ['control', 'shift'])
    check('a source file goes to its .test file', !!(await waitFor(async () => (await activeTab()).includes('calc.test.ts'), 4000)), await activeTab())
    key('T', ['control', 'shift'])
    check('and the test goes back to the source', !!(await waitFor(async () => /calc\.ts/.test(await activeTab()) && !(await activeTab()).includes('test'), 4000)), await activeTab())

    await open('util.py')
    key('T', ['control', 'shift'])
    check('Python: util.py goes to test_util.py', !!(await waitFor(async () => (await activeTab()).includes('test_util.py'), 4000)), await activeTab())

    await open('lonely.ts')
    key('T', ['control', 'shift'])
    check('a file without a test says so', !!(await waitFor(async () => (await text('log')).includes('No test file found for lonely.ts'), 4000)), (await text('log')).slice(-200))

    await open('multi.ts')
    key('T', ['control', 'shift'])
    check('several tests are offered in a menu', !!(await waitFor(() => js("document.querySelectorAll('#ctx .ctx-item').length === 2"), 4000)))
    await js("document.querySelector('#ctx .ctx-item').click()")
    check('choosing one opens it', !!(await waitFor(async () => /multi\.(test|spec)\.ts/.test(await activeTab()), 4000)), await activeTab())
  }
)
