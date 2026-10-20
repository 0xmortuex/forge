// A smoke test for the packaged app (pnpm dist:dir first): starts release/win-unpacked/Forge.exe (or the Linux / macOS
// equivalent) with its own throw-away user-data folder, and checks over the DevTools protocol that the pieces that live in
// node_modules work from the packaged files: the page itself, a real shell (node-pty), the spell-check dictionary and
// a language-server launcher.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const WebSocket = require('ws')

const root = path.join(__dirname, '..', 'release')
const exe =
  process.platform === 'win32' ? path.join(root, 'win-unpacked', 'Forge.exe')
  : process.platform === 'darwin' ? path.join(root, 'mac', 'Forge.app', 'Contents', 'MacOS', 'Forge')
  : path.join(root, 'linux-unpacked', 'forge')
if (!fs.existsSync(exe)) {
  console.log(`FAIL packaged: ${exe} does not exist: run "pnpm dist:dir" first`)
  process.exit(1)
}

const PORT = 9333
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-packaged-'))
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-packaged-project-'))
fs.writeFileSync(path.join(project, 'a.txt'), 'hello\n')
const results = []
const check = (label, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} packaged: ${label}${ok ? '' : detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const getJson = (url) =>
  new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })

async function main() {
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { env: { ...process.env, FORGE_USER_DATA: userData }, stdio: 'ignore' })
  let exited = false
  child.on('exit', () => (exited = true))
  try {
    let targets = []
    for (let i = 0; i < 60 && !targets.some((t) => t.type === 'page'); i++) {
      await sleep(500)
      targets = await getJson(`http://127.0.0.1:${PORT}/json`).catch(() => [])
    }
    const page = targets.find((t) => t.type === 'page')
    check('the packaged app starts and opens a window', !!page && !exited)
    if (!page) return
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r) => ws.on('open', r))
    let id = 0
    const pending = new Map()
    ws.on('message', (m) => {
      const msg = JSON.parse(String(m))
      if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg)
    })
    const evaluate = (expression) =>
      new Promise((resolve) => {
        const n = ++id
        pending.set(n, resolve)
        ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      }).then((m) => (m.result.exceptionDetails ? { error: m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text } : m.result.result.value))

    for (let i = 0; i < 40 && (await evaluate("typeof window.forge === 'object' && !!document.getElementById('welcome')")) !== true; i++) await sleep(500)
    check('the page loads with its preload bridge', (await evaluate("typeof window.forge.termCreate === 'function'")) === true)

    const pty = await evaluate(`window.forge.termCreate(${JSON.stringify(project)}, 80, 24).then((id) => { window.forge.termKill(id); return typeof id })`)
    check('a real shell starts (node-pty works from the package)', pty === 'number', JSON.stringify(pty))

    const dict = await evaluate('window.forge.spellDictionary().then((d) => ({ aff: (d.aff || "").length, dic: (d.dic || "").length }))')
    check('the spell-check dictionary is found', !!dict && dict.aff > 100 && dict.dic > 1000, JSON.stringify(dict))

    for (const [file, text] of [['config.yaml', 'a: 1\n'], ['main.ts', 'const x: number = 1\n']]) {
      const full = path.join(project, file)
      fs.writeFileSync(full, text)
      const uri = 'file:///' + full.split(path.sep).join('/')
      const caps = await evaluate(`window.forge.lspOpen(${JSON.stringify(project)}, ${JSON.stringify(uri)}, ${JSON.stringify(full)}, 1, ${JSON.stringify(text)}).then(async (ok) => ok ? Object.keys(await window.forge.lspCapabilities(${JSON.stringify(uri)})).length : -1)`)
      check(`the bundled language server for ${file} starts`, typeof caps === 'number' && caps > 0, JSON.stringify(caps))
    }
    ws.close()
  } finally {
    child.kill()
    await sleep(1500)
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
  const failed = results.filter((r) => !r).length
  console.log(failed ? `FAILED packaged: ${results.length - failed}/${results.length} checks passed` : `OK packaged: ${results.length}/${results.length} checks passed`)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.log(`FAIL packaged: ${err && err.stack ? err.stack : err}`)
  process.exit(1)
})
