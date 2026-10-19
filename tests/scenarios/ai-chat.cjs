// @ts-check
// The AI Assistant against a mock OpenAI-compatible server: settings + key, connection test, streaming answers, code
// block buttons, the selection actions, an error, Stop, and New Chat.
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('../harness.cjs')
const { startMockAi } = require('../mock-ai.cjs')

startMockAi().then((mock) =>
  run(
    'ai-chat',
    { 'a.ts': 'export function add(a: number, b: number) {\n  return a + b\n}\n' },
    async (t) => {
      const { js, key, type, enter, check, sleep, waitFor, userData } = t
      const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)
      const editorText = () => js("[...document.querySelectorAll('#editor .view-line')].sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top)).map(l => l.textContent.replace(/\\u00a0/g, ' ')).filter(Boolean).join('|')")
      const lastRequest = () => mock.requests[mock.requests.length - 1]
      const runPalette = async (/** @type {string} */ query) => {
        key('P', ['control', 'shift'])
        await waitFor(() => js("!document.getElementById('palette').hidden"), 3000)
        await sleep(400)
        await type(query)
        await sleep(600)
        key('Enter')
        await sleep(400)
      }
      const askInChat = async (/** @type {string} */ question) => {
        await js("document.getElementById('ai-input').focus(); undefined")
        await type(question)
        enter()
      }
      const focusEditor = () => js("document.querySelector('#editor textarea').focus(); undefined")

      key('O', ['control'])
      await waitFor(async () => (await text('tree')).includes('a.ts'), 5000)
      await js("[...document.querySelectorAll('.node')].find(x => x.textContent === 'a.ts').click()")
      await waitFor(async () => (await editorText()).includes('add'), 4000)

      // ---- settings: the key is stored encrypted, and the connection test works ----
      key(',', ['control'])
      await waitFor(() => js("!document.getElementById('settings').hidden"), 3000)
      await js("document.querySelector('.snav[data-cat=\"AI\"]').click()")
      await waitFor(() => js("!!document.getElementById('ai-key-input')"), 3000)
      await js("document.getElementById('ai-key-input').focus(); undefined")
      await type('sk-test-123')
      await js("document.getElementById('ai-key-save').click()")
      const keyFile = path.join(userData, 'ai-key.bin')
      check('the API key is stored in a file', !!(await waitFor(() => fs.existsSync(keyFile), 4000)))
      check('...encrypted, not as plain text', fs.existsSync(keyFile) && !fs.readFileSync(keyFile).includes('sk-test-123'))
      check('...and settings.json does not contain it', !fs.readFileSync(path.join(userData, 'settings.json'), 'utf8').includes('sk-test-123'))
      check('the page says a key is stored', !!(await waitFor(async () => (await js('document.body.textContent')).includes('A key is stored'), 3000)))
      await js("document.getElementById('ai-test').click()")
      check('Test connection reports success and the reply', !!(await waitFor(async () => /Connected in \d+ ms.*ready/.test(await text('ai-test-result')), 8000)), await text('ai-test-result'))
      check('the key reached the server as a bearer token', lastRequest()?.authorization === 'Bearer sk-test-123', String(lastRequest()?.authorization))
      await js("document.getElementById('settings-close').click()")

      // ---- the chat window ----
      await focusEditor()
      key('8', ['alt'])
      check('Alt+8 opens the AI Assistant', !!(await waitFor(() => js("!document.getElementById('view-ai').hidden"), 3000)))
      check('the model is shown in the header', (await text('ai-model')).includes('mock-model'), await text('ai-model'))
      await askInChat('what does add do?')
      check('the answer streams in as Markdown with a code block', !!(await waitFor(() => js("!!document.querySelector('#ai-thread .ai-msg.assistant pre code')"), 8000)))
      check('the answer text is shown', (await text('ai-thread')).includes('Mock answer.'))
      const req = mock.requests.filter((r) => r.body?.stream)[0]
      check('the request was streamed to the chosen model', req?.body.model === 'mock-model' && req.body.stream === true, JSON.stringify(req?.body.model))
      check('it carries the system prompt', req?.body.messages[0].content.includes('coding assistant'))
      const userMsg = req?.body.messages[req.body.messages.length - 1].content ?? ''
      check('the open file is attached to the question', userMsg.includes('File: a.ts') && userMsg.includes('export function add') && userMsg.includes('what does add do?'), userMsg.slice(0, 160))
      check('Send comes back after the answer', !!(await waitFor(() => js("!document.getElementById('ai-send').hidden && document.getElementById('ai-stop').hidden"), 3000)))

      // ---- code block buttons ----
      await focusEditor()
      key('End', ['control'])
      await js("document.querySelector('#ai-thread .ai-insert').click()")
      check('Insert puts the code block at the cursor', !!(await waitFor(async () => (await editorText()).includes("console.log('mock')"), 3000)), await editorText())
      key('Z', ['control'])
      await waitFor(async () => !(await editorText()).includes("console.log('mock')"), 3000)

      // ---- a selection action ----
      await focusEditor()
      key('A', ['control'])
      await sleep(300)
      const before = mock.requests.length
      await runPalette('Explain Code')
      check('Explain Code asks with the selection attached', !!(await waitFor(() => mock.requests.length > before, 6000)))
      const explain = mock.requests[mock.requests.length - 1]?.body.messages.slice(-1)[0].content ?? ''
      check('...as "Selected code"', explain.includes('Selected code:') && explain.includes('return a + b') && explain.toLowerCase().includes('explain'), explain.slice(0, 200))
      check('...and the chat shows the action name', !!(await waitFor(async () => (await text('ai-thread')).includes('Explain Code'), 3000)))
      await waitFor(() => js("document.getElementById('ai-stop').hidden"), 8000)

      // ---- an error is shown in the thread ----
      await askInChat('trigger-error please')
      check('a server error appears as a problem in the chat', !!(await waitFor(async () => /mock server exploded/.test(await js("document.querySelector('#ai-thread .ai-msg.error')?.textContent ?? ''")), 8000)), await js("document.querySelector('#ai-thread .ai-msg.error')?.textContent ?? ''"))

      // ---- Stop ----
      await askInChat('trigger-slow please')
      await waitFor(async () => /slow0/.test(await text('ai-thread')), 6000)
      check('Stop is offered while an answer streams', !(await js("document.getElementById('ai-stop').hidden")))
      await js("document.getElementById('ai-stop').click()")
      check('stopping keeps what arrived and brings Send back', !!(await waitFor(() => js("document.getElementById('ai-stop').hidden && !document.getElementById('ai-send').hidden"), 4000)))
      check('the server saw the request being abandoned', !!(await waitFor(() => lastRequest()?.aborted === true, 4000)))
      check('the partial answer stays on screen', (await text('ai-thread')).includes('slow0'))

      // ---- New Chat ----
      await js("document.getElementById('ai-new').click()")
      check('New Chat clears the conversation', !!(await waitFor(async () => !(await text('ai-thread')).includes('Mock answer.'), 3000)))
    },
    {
      userData: {
        'settings.json': JSON.stringify({ aiBaseUrl: `http://127.0.0.1:${mock.port}/v1`, aiModel: 'mock-model' })
      }
    }
  ).finally(() => mock.close())
)
