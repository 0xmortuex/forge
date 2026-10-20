// A stand-in for a debug adapter, used by the generic-adapter tests. It "debugs" a toy language over stdio, with real
// Debug Adapter Protocol framing: each line of the program is a statement,
//     x = 5           sets a variable (a number)
//     list = 1,2,3    sets a variable that has children
//     print hello     writes "hello" to the program's output
// Breakpoints, continue, next / stepIn / stepOut, stackTrace, scopes, variables, evaluate and disconnect work. Right after
// launch it sends the client a runInTerminal request (which Forge does not support) to check that it is answered.
// When its first argument is a port number it listens on that TCP port instead of using stdio.
const fs = require('node:fs')
const net = require('node:net')

let seq = 1
let write = (/** @type {string} */ _data) => {}
const send = (/** @type {any} */ msg) => {
  const body = JSON.stringify({ seq: seq++, ...msg })
  write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}
const respond = (/** @type {any} */ req, /** @type {any} */ body = {}) => send({ type: 'response', request_seq: req.seq, success: true, command: req.command, body })
const fail = (/** @type {any} */ req, /** @type {string} */ message) => send({ type: 'response', request_seq: req.seq, success: false, command: req.command, message })
const event = (/** @type {string} */ name, /** @type {any} */ body = {}) => send({ type: 'event', event: name, body })

/** @type {string[]} */
let lines = []
let program = ''
let line = 1 // the next line to execute (1-based)
/** @type {Set<number>} */
let breakpoints = new Set()
/** @type {Record<string, string>} */
let vars = {}
/** @type {Record<string, string[]>} */
let lists = {}
let started = false

function step() {
  const text = (lines[line - 1] ?? '').trim()
  let m
  if ((m = /^print\s+(.*)$/.exec(text))) event('output', { category: 'stdout', output: m[1] + '\n' })
  else if ((m = /^(\w+)\s*=\s*(\d+(?:\.\d+)?)$/.exec(text))) vars[m[1]] = m[2]
  else if ((m = /^(\w+)\s*=\s*([\d,]+)$/.exec(text))) lists[m[1]] = m[2].split(',')
  line++
}

function done() {
  event('exited', { exitCode: 0 })
  event('terminated')
}

function stop(/** @type {string} */ reason) {
  event('stopped', { reason, threadId: 1, allThreadsStopped: true })
}

function runToBreakpoint() {
  while (line <= lines.length) {
    if (breakpoints.has(line)) return stop('breakpoint')
    step()
  }
  done()
}

function handle(/** @type {any} */ req) {
  switch (req.command) {
    case 'initialize':
      respond(req, { supportsConfigurationDoneRequest: true })
      event('initialized')
      break
    case 'launch': {
      program = req.arguments.program
      if (!program || !fs.existsSync(program)) return fail(req, `program not found: ${program}`)
      lines = fs.readFileSync(program, 'utf8').split(/\r?\n/)
      started = true
      // Held until configurationDone, as real adapters do.
      pendingLaunch = req
      break
    }
    case 'setBreakpoints':
      breakpoints = new Set(req.arguments.breakpoints.map((/** @type {any} */ b) => b.line))
      respond(req, { breakpoints: req.arguments.breakpoints.map((/** @type {any} */ b) => ({ verified: true, line: b.line })) })
      break
    case 'configurationDone':
      respond(req)
      if (pendingLaunch) {
        respond(pendingLaunch)
        pendingLaunch = null
        // Forge cannot run things in a terminal; the adapter must hear "no" rather than wait.
        send({ type: 'request', command: 'runInTerminal', arguments: { args: ['x'], kind: 'integrated' } })
        setTimeout(runToBreakpoint, 50)
      }
      break
    case 'continue':
      respond(req, { allThreadsContinued: true })
      event('continued', { threadId: 1 })
      step() // leave the line we are stopped on
      runToBreakpoint()
      break
    case 'next':
    case 'stepIn':
      respond(req)
      step()
      if (line > lines.length) done()
      else stop('step')
      break
    case 'stepOut':
      respond(req)
      while (line <= lines.length) step()
      done()
      break
    case 'pause':
      respond(req)
      break
    case 'threads':
      respond(req, { threads: [{ id: 1, name: 'main' }] })
      break
    case 'stackTrace':
      respond(req, { stackFrames: [{ id: 1, name: 'main', source: { path: program }, line, column: 1 }], totalFrames: 1 })
      break
    case 'scopes':
      respond(req, { scopes: [{ name: 'Locals', variablesReference: 1, expensive: false }] })
      break
    case 'variables':
      if (req.arguments.variablesReference === 1) {
        respond(req, {
          variables: [
            ...Object.entries(vars).map(([name, value]) => ({ name, value, type: 'int', variablesReference: 0 })),
            ...Object.keys(lists).map((name) => ({ name, value: `[${lists[name].length}]`, type: 'int[]', variablesReference: 2 }))
          ]
        })
      } else {
        respond(req, { variables: Object.values(lists)[0].map((v, i) => ({ name: String(i), value: v, type: 'int', variablesReference: 0 })) })
      }
      break
    case 'evaluate': {
      const expr = String(req.arguments.expression).trim()
      if (expr in vars) respond(req, { result: vars[expr], type: 'int', variablesReference: 0 })
      else fail(req, `unknown name: ${expr}`)
      break
    }
    case 'disconnect':
      respond(req)
      setTimeout(() => process.exit(0), 20)
      break
    default:
      fail(req, `fake adapter: unsupported request ${req.command}`)
  }
}

/** @type {any} */
let pendingLaunch = null
void started

let buf = Buffer.alloc(0)
function onData(/** @type {Buffer} */ chunk) {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n')
    if (sep < 0) return
    const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, sep).toString())?.[1])
    if (buf.length < sep + 4 + len) return
    const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString())
    buf = buf.subarray(sep + 4 + len)
    if (msg.type === 'request') handle(msg)
    else if (msg.type === 'response' && msg.command === 'runInTerminal') {
      event('output', { category: 'console', output: `[adapter] runInTerminal answered: ${msg.success ? 'yes' : 'no'}: ${msg.message ?? ''}\n` })
    }
  }
}

if (/^\d+$/.test(process.argv[2] ?? '')) {
  const port = Number(process.argv[2])
  net.createServer((socket) => {
    write = (data) => void socket.write(data)
    socket.on('data', onData)
  }).listen(port, '127.0.0.1')
} else {
  write = (data) => void process.stdout.write(data)
  process.stdin.on('data', onData)
}
