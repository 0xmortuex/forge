// @ts-check
// Inspect Code: the whole project is checked with tsc, including files that are not open.
const { run } = require('../harness.cjs')

run(
  'inspect',
  {
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true }, include: ['*.ts'] }),
    'open.ts': 'export const ok: number = 1\n',
    'broken.ts': "export const bad: number = 'text'\nexport const worse: string = 5\n"
  },
  async (t) => {
    const { js, key, check, waitFor } = t
    const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('open.ts'), 5000)
    await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'open.ts').click()")
    key('6', ['alt'])
    await waitFor(() => js("!!document.getElementById('problems-inspect')"), 3000)
    check('before inspecting, the hint offers Inspect Code', (await text('problems-list')).includes('Inspect Code'), await text('problems-list'))

    await js("document.getElementById('problems-inspect').click()")
    check('project problems appear for a file that is not open', !!(await waitFor(async () => (await text('problems-list')).includes('broken.ts'), 40000)), await text('problems-list'))
    const list = await text('problems-list')
    check('both errors are listed with their TS codes', list.includes('TS2322') && (await js("document.querySelectorAll('#problems-list .prob.error').length")) === 2, list)
    check('the section says what ran', list.includes('Project analysis') && list.includes('tsc'), list)

    await js("document.querySelector('#problems-list .prob.error').click()")
    check('clicking a problem opens its file', !!(await waitFor(async () => (await text('tabs')).includes('broken.ts'), 4000)), await text('tabs'))
  }
)
