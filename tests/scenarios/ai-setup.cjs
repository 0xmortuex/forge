// @ts-check
// With nothing configured the assistant says so and leads to Settings → AI instead of failing obscurely.
const { run } = require('../harness.cjs')

run('ai-setup', { 'a.ts': 'export const a = 1\n' }, async (t) => {
  const { js, key, check, sleep, waitFor } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)

  key('O', ['control'])
  await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)
  await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'a.ts').click()")
  await sleep(800)
  key('8', ['alt'])
  await waitFor(() => js("!document.getElementById('view-ai').hidden"), 3000)
  check('the header says it is not set up', (await text('ai-model')).includes('not set up'), await text('ai-model'))
  check('the window offers to open the AI settings', (await text('ai-thread')).includes('not set up yet') && (await js("!!document.getElementById('ai-setup')")))
  await js("document.getElementById('ai-setup').click()")
  check('that button opens Settings on the AI page', !!(await waitFor(async () => (await js("!document.getElementById('settings').hidden")) && (await js("!!document.getElementById('ai-key-input')")), 3000)))
  check('the AI page has the server and model fields', (await text('settings')).includes('Server URL') && (await text('settings')).includes('Model'))
  await js("document.getElementById('ai-test').click()")
  check('testing without a server URL gives a clear message', !!(await waitFor(async () => /not set up|base URL/.test(await text('ai-test-result')), 4000)), await text('ai-test-result'))
})
