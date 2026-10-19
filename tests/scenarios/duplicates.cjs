// @ts-check
// "Find Duplicated Code": a block copy-pasted into three files is reported once, brace-only code is not a duplicate, the
// minimum length matters, and a place in the list opens the file there.
const { run } = require('../harness.cjs')

const COPY = [
  'export function computeTotal(items: Item[]): number {',
  '  let total = 0',
  '  for (const item of items) {',
  '    if (item.price < 0) {',
  "      throw new Error('negative price')",
  '    }',
  '    total += item.price * item.qty',
  '  }',
  '  return Math.round(total * 100) / 100',
  '}'
].join('\n')

const file = (/** @type {string} */ before, /** @type {string} */ after) => `${before}\n\n${COPY}\n\n${after}\n`
const braces = Array.from({ length: 12 }, () => '});').join('\n') + '\n'

run(
  'duplicates',
  {
    'src/a.ts': file("import { Item } from './item'\nconst A = 1", 'export const afterA = A + 1'),
    'src/b.ts': file("import { Item } from './item'\nconst B = 2", 'export const afterB = B * 2'),
    'src/c.ts': file("import { Item } from './item'\nconst C = 3", 'export const afterC = C - 3'),
    'src/unique.ts': 'export const unique = [1, 2, 3].map((n) => n * 2)\nexport const other = unique.length\n',
    'src/braces1.ts': braces,
    'src/braces2.ts': braces
  },
  async (t) => {
    const { js, key, type, check, sleep, waitFor } = t
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

    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('src'), 5000)
    await runPalette('Find Duplicated Code')
    check('the Duplicates window opens and scans', !!(await waitFor(() => js("!document.getElementById('view-dup').hidden && /duplicated block/.test(document.getElementById('dup-status').textContent)"), 10000)), await text('dup-status'))
    const groups = await js("document.querySelectorAll('#dup-list .dup-group').length")
    check('the copied function is reported once (brace-only files are not duplicates)', groups === 1, `${groups}: ${await text('dup-list')}`)
    check('it says it appears 3 times, 7 code lines long', (await text('dup-list')).includes('3× 7 lines'), await text('dup-list'))
    check('the status counts the redundant lines', /14 redundant lines/.test(await text('dup-status')), await text('dup-status'))

    await js("document.querySelector('#dup-list .dup-group').click()")
    check('opening a group shows the code', !!(await waitFor(async () => (await text('dup-list')).includes('computeTotal'), 3000)), await text('dup-list'))
    const places = await js("[...document.querySelectorAll('#dup-list .dup-occ .dup-path')].map(e => e.textContent.replace(/\\\\/g, '/')).join('|')")
    check('...and every place it occurs', places === 'src/a.ts|src/b.ts|src/c.ts', places)
    const rangeOfB = await js("document.querySelectorAll('#dup-list .dup-occ .dup-range')[1].textContent")
    check('with line ranges', /^\d+–\d+$/.test(rangeOfB), rangeOfB)

    await js("document.querySelectorAll('#dup-list .dup-occ')[1].click()")
    check('clicking a place opens that file there', !!(await waitFor(async () => (await js("document.querySelector('.tab.active')?.textContent ?? ''")).includes('b.ts') && (await text('st-pos')).startsWith(rangeOfB.split('–')[0] + ':'), 5000)), `${await js("document.querySelector('.tab.active')?.textContent ?? ''")} ${await text('st-pos')} wanted line ${rangeOfB}`)

    // A higher minimum drops it.
    await js("(() => { const s = document.getElementById('dup-min'); s.value = '10'; s.dispatchEvent(new Event('change')) })()")
    await js("document.getElementById('dup-scan').click()")
    check('a longer minimum finds nothing', !!(await waitFor(async () => (await text('dup-list')).includes('No duplicated blocks of 10+ lines'), 10000)), await text('dup-list'))
  }
)
