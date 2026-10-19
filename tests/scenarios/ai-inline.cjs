// @ts-check
// Inline suggestions: after a pause the surrounding code is sent, the answer shows as ghost text, Tab accepts it, and
// turning the setting off stops the requests.
const { run } = require('../harness.cjs')
const { startMockAi } = require('../mock-ai.cjs')

startMockAi().then((mock) =>
  run(
    'ai-inline',
    { 'a.ts': 'function greet() {\n  return 1\n}\nconst x =' },
    async (t) => {
      const { js, key, type, check, sleep, waitFor } = t
      const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
      const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\\u00a0/g, ' ')).filter(Boolean).join('|')")
      const ghost = () => js("[...document.querySelectorAll('#editor .ghost-text, #editor .ghost-text-decoration')].map(e => e.textContent).join('')")
      const inlineRequests = () => mock.requests.filter((r) => !r.body?.stream && (r.body?.messages?.[0]?.content ?? '').includes('code completion engine')).length

      key('O', ['control'])
      await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)
      await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'a.ts').click()")
      await waitFor(async () => (await editorText()).includes('greet'), 4000)
      await js("document.querySelector('#editor textarea').focus(); undefined")
      key('End', ['control'])
      await type(' ')

      check('a pause in typing asks the server for a completion', !!(await waitFor(() => inlineRequests() >= 1, 8000)))
      const req = mock.requests.find((r) => (r.body?.messages?.[0]?.content ?? '').includes('code completion engine'))
      const prompt = req?.body.messages[1].content ?? ''
      check('the prompt has the code around a <CURSOR> marker', prompt.includes('function greet()') && prompt.includes('const x = <CURSOR>'), prompt.slice(-80))
      check('the request is short and deterministic', req?.body.max_tokens === 128 && req?.body.temperature === 0, JSON.stringify([req?.body.max_tokens, req?.body.temperature]))
      check('the suggestion shows as ghost text', !!(await waitFor(async () => (await ghost()).includes('mockCompletion()'), 6000)), await ghost())

      key('Tab')
      check('Tab accepts it into the file', !!(await waitFor(async () => (await editorText()).includes('const x = mockCompletion()'), 4000)), await editorText())

      // Turn it off in Settings: more typing sends nothing.
      key(',', ['control'])
      await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
      await js("document.querySelector('.snav[data-cat=\"AI\"]').click()")
      await sleep(500)
      await js("[...document.querySelectorAll('.srow')].find(r => r.querySelector('.label')?.textContent === 'Suggest code as you type').querySelector('.switch').click()")
      await js("document.getElementById('settings-close').click()")
      await sleep(400)
      const before = inlineRequests()
      await js("document.querySelector('#editor textarea').focus(); undefined")
      await type(';')
      await sleep(2000)
      check('with the setting off, typing sends no completion requests', inlineRequests() === before, `${before} -> ${inlineRequests()}`)
    },
    {
      userData: {
        'settings.json': JSON.stringify({ aiBaseUrl: `http://127.0.0.1:${mock.port}/v1`, aiModel: 'mock-model', aiInline: true })
      }
    }
  ).finally(() => mock.close())
)
