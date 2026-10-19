// @ts-check
// A stand-in for an OpenAI-compatible server (POST /v1/chat/completions), so the AI features can be tested without a
// network, a key or a bill. It records every request, and picks its answer from the prompt:
//   - the inline-completion system prompt   -> a short code completion
//   - the commit-message system prompt      -> a commit message
//   - a message containing "trigger-error"  -> HTTP 500 with a JSON error
//   - a message containing "trigger-slow"   -> a slow stream (one chunk per 250 ms for ~5 s) that can be stopped
//   - anything else                         -> "Mock answer." and a fenced code block, streamed in small chunks
const http = require('node:http')

/**
 * @typedef {{ method: string, url: string, authorization: string | undefined, body: any, aborted: boolean }} Recorded
 * @returns {Promise<{ port: number, requests: Recorded[], close: () => Promise<void> }>}
 */
function startMockAi() {
  /** @type {Recorded[]} */
  const requests = []
  const handler = (/** @type {http.IncomingMessage} */ req, /** @type {http.ServerResponse} */ res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      /** @type {Recorded} */
      const rec = { method: req.method ?? '', url: req.url ?? '', authorization: req.headers['authorization'], body: null, aborted: false }
      requests.push(rec)
      res.on('close', () => {
        if (!res.writableEnded) rec.aborted = true
      })
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: 'not found' } }))
      }
      try {
        rec.body = JSON.parse(raw)
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: 'bad json' } }))
      }
      /** @type {{ role: string, content: string }[]} */
      const messages = rec.body.messages ?? []
      const system = messages.find((m) => m.role === 'system')?.content ?? ''
      const last = messages[messages.length - 1]?.content ?? ''

      if (last.includes('trigger-error')) {
        res.writeHead(500, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: 'mock server exploded' } }))
      }

      let reply
      if (system.includes('code completion engine')) reply = 'mockCompletion()'
      else if (system.includes('git commit messages')) reply = 'Add mock feature\n\nMock body line.'
      else if (last.includes('Reply with the single word: ready')) reply = 'ready'
      else reply = "Mock answer.\n\n```js\nconsole.log('mock')\n```\n"

      if (!rec.body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }))
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const slow = last.includes('trigger-slow')
      const pieces = slow ? Array.from({ length: 20 }, (_, i) => `slow${i} `) : reply.match(/[\s\S]{1,7}/g) ?? []
      let i = 0
      const timer = setInterval(
        () => {
          if (res.writableEnded || res.destroyed) return clearInterval(timer)
          if (i >= pieces.length) {
            clearInterval(timer)
            res.write('data: [DONE]\n\n')
            return res.end()
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[i] } }] })}\n\n`)
          i++
        },
        slow ? 250 : 15
      )
      res.on('close', () => clearInterval(timer))
    })
  }
  const server = http.createServer(handler)
  const alias = http.createServer(handler)
  return new Promise((resolve) => {
    // Also answering on 127.0.0.2 lets a test reach the server under an address Forge does not treat as "local".
    server.listen(0, '127.0.0.1', () => {
      const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port
      alias.listen(port, '127.0.0.2', () => {
        resolve({
          port,
          requests,
          close: () =>
            Promise.all(
              [server, alias].map(
                (srv) =>
                  new Promise((done) => {
                    srv.closeAllConnections()
                    srv.close(() => done(undefined))
                  })
              )
            ).then(() => undefined)
        })
      })
    })
  })
}

module.exports = { startMockAi }
