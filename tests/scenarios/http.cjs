// @ts-check
// The HTTP client: .http files, gutter arrows, variables, the Response window (body, headers, errors).
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('http', { 'readme.txt': 'x\n' }, async (t) => {
  const { js, key, check, sleep, waitFor, root, wc } = t
  const text = (/** @type {string} */ id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`)

  // A tiny server for the requests to talk to.
  /** @type {{ method?: string, url?: string, headers: any, body: string }[]} */
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body })
      if (req.url === '/missing') {
        res.writeHead(404, { 'content-type': 'text/plain' })
        return res.end('nope')
      }
      res.writeHead(200, { 'content-type': 'application/json', 'x-demo': 'yes' })
      res.end(JSON.stringify({ path: req.url, method: req.method, echoed: body ? JSON.parse(body) : null }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port

  const file = [
    `@host = http://127.0.0.1:${port}`,
    '@token = abc123',
    '',
    '### List things',
    'GET {{host}}/things?limit=2',
    'Accept: application/json',
    '',
    '### Create a thing',
    'POST {{host}}/things',
    'Content-Type: application/json',
    'Authorization: Bearer {{token}}',
    '',
    '{ "name": "widget" }',
    '',
    '### Missing',
    'GET {{host}}/missing',
    '',
    '### Nobody home',
    'GET http://127.0.0.1:1/',
    ''
  ].join('\n')
  fs.writeFileSync(path.join(root, 'api.http'), file)

  try {
    key('O', ['control'])
    await waitFor(async () => (await text('tree')).includes('readme.txt'), 5000)
    check('a .http file added outside Forge shows up (file watching)', !!(await waitFor(async () => (await text('tree')).includes('api.http'), 3000)))
    await js("[...document.querySelectorAll('.node')].find(n => n.textContent === 'api.http').click()")
    await waitFor(async () => (await text('tabs')).includes('api.http'), 3000)
    check('every request gets a run arrow in the gutter', !!(await waitFor(async () => (await js("document.querySelectorAll('.http-run-glyph').length")) === 4, 4000)), String(await js("document.querySelectorAll('.http-run-glyph').length")))

    const click = async (/** @type {number} */ index) => {
      const at = await js(`(() => { const r = document.querySelectorAll('.http-run-glyph')[${index}].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2 + 2), y: Math.round(r.top + r.height / 2) } })()`)
      wc.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y })
      wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    }

    // ---- GET with a variable ----
    await click(0)
    check('clicking the arrow sends the request and shows the status', !!(await waitFor(async () => (await text('view-http')).includes('200 OK'), 8000)), await text('view-http'))
    check('{{host}} was filled in, query string and headers sent', seen[0]?.method === 'GET' && seen[0]?.url === '/things?limit=2' && seen[0]?.headers.accept === 'application/json', JSON.stringify(seen[0]))
    check('a JSON body is shown pretty-printed', (await text('http-body')).includes('"method": "GET"'), await text('http-body'))
    await js("[...document.querySelectorAll('#view-http .chip')].find(c => c.textContent === 'Headers').click()")
    check('the Headers tab lists the response headers', (await text('http-body')).includes('x-demo: yes'), await text('http-body'))
    await js("[...document.querySelectorAll('#view-http .chip')].find(c => c.textContent === 'Body').click()")

    // ---- POST with a body and a variable in a header (run from the keyboard) ----
    await js("document.querySelector('#editor .monaco-editor textarea').focus(); undefined")
    key('Home', ['control'])
    for (let i = 0; i < 11; i++) key('Down') // inside the POST request
    key('Enter', ['control'])
    check('Ctrl+Enter runs the request the cursor is in', !!(await waitFor(() => seen.length === 2, 8000)), String(seen.length))
    check('...with its method, header variable and body', seen[1]?.method === 'POST' && seen[1]?.headers.authorization === 'Bearer abc123' && seen[1]?.body.includes('"widget"'), JSON.stringify(seen[1]))
    check('...and the server\'s answer is shown', !!(await waitFor(async () => (await text('http-body')).includes('"name": "widget"'), 5000)), await text('http-body'))

    // ---- status colors and errors ----
    await click(2)
    check('a 404 is shown with its status', !!(await waitFor(async () => (await text('view-http')).includes('404'), 8000)))
    check('...as a warning', (await js("document.querySelector('#view-http .http-status').className")).includes('warn'))
    await click(3)
    check('a request that cannot connect says so instead of hanging', !!(await waitFor(async () => (await text('view-http')).includes('Request failed'), 15000)), await text('view-http'))
    check('...and the reason is shown, not swallowed', (await text('http-body')).length > 0 && (await text('log')).includes('HTTP request:'), await text('http-body'))
  } finally {
    server.close()
    await sleep(100)
  }
})
