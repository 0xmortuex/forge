// @ts-check
// Code only leaves the machine after the user agrees to that server: declining sends nothing, agreeing is remembered,
// and a local server (127.0.0.1, which Forge treats as "on this machine") is not asked about.
const { run } = require('../harness.cjs')
const { startMockAi } = require('../mock-ai.cjs')

startMockAi().then((mock) =>
  run(
    'ai-consent',
    { 'a.ts': 'export const a = 1\n' },
    async (t) => {
      const { js, key, type, enter, check, sleep, waitFor } = t
      const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
      const streamed = () => mock.requests.filter((r) => r.body?.stream).length
      const ask = async (/** @type {string} */ q) => {
        await js("document.getElementById('ai-input').focus(); undefined")
        await type(q)
        enter()
      }

      key('O', ['control'])
      await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)
      await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'a.ts').click()")
      await sleep(800)
      key('8', ['alt'])
      await waitFor(() => js("!document.getElementById('view-ai').hidden"), 3000)

      // Decline once.
      await js("window.__asked = []; window.__answer = false; window.confirm = (m) => { window.__asked.push(m); return window.__answer }; undefined")
      await ask('first question')
      check('a new server is asked about, naming its host', !!(await waitFor(async () => (await js('window.__asked.length')) === 1, 4000)) && (await js('window.__asked[0]')).includes(`127.0.0.2:${mock.port}`), String(await js('window.__asked[0]')))
      check('declining shows that nothing was sent', !!(await waitFor(async () => /nothing was sent/.test(await js("document.querySelector('#ai-thread .ai-msg.error')?.textContent ?? ''")), 4000)))
      check('...and the server received nothing', streamed() === 0, String(streamed()))

      // Agree.
      await js('window.__answer = true; undefined')
      await ask('second question')
      check('agreeing lets the question through', !!(await waitFor(() => streamed() === 1, 6000)))
      await waitFor(() => js("document.getElementById('ai-stop').hidden"), 8000)

      // Remembered.
      await ask('third question')
      check('the agreement is remembered (no second prompt)', !!(await waitFor(() => streamed() === 2, 6000)) && (await js('window.__asked.length')) === 2, String(await js('window.__asked.length')))
    },
    {
      userData: {
        // 127.0.0.2 is loopback, but not one of the addresses Forge treats as local, so it counts as "another server".
        'settings.json': JSON.stringify({ aiBaseUrl: `http://127.0.0.2:${mock.port}/v1`, aiModel: 'mock-model' })
      }
    }
  ).finally(() => mock.close())
)
