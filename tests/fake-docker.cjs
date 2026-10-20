// A stand-in for the docker CLI, used by the Docker window tests (FORGE_DOCKER points here). It keeps its containers in the
// file named by FAKE_DOCKER_STATE so that stop / start / rm show up in the next listing, and records every call in
// FAKE_DOCKER_LOG (one JSON array of arguments per line).
const fs = require('node:fs')

const args = process.argv.slice(2)
if (process.env['FAKE_DOCKER_LOG']) fs.appendFileSync(process.env['FAKE_DOCKER_LOG'], JSON.stringify(args) + '\n')

const out = (/** @type {string} */ s) => process.stdout.write(s + '\n')
const fail = (/** @type {string} */ s) => {
  process.stderr.write(s + '\n')
  process.exit(1)
}

const stateFile = process.env['FAKE_DOCKER_STATE'] ?? ''
const initial = [
  { ID: 'c1', Names: 'web', Image: 'nginx:1', State: 'running', Status: 'Up 3 minutes', Ports: '0.0.0.0:8080->80/tcp' },
  { ID: 'c2', Names: 'db', Image: 'postgres:16', State: 'exited', Status: 'Exited (0) 2 hours ago', Ports: '' },
  { ID: 'c3', Names: 'cache', Image: 'redis:7', State: 'paused', Status: 'Up 1 hour (Paused)', Ports: '6379/tcp' }
]
const load = () => (stateFile && fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : initial)
const save = (/** @type {any[]} */ list) => stateFile && fs.writeFileSync(stateFile, JSON.stringify(list))

const [a, b] = args
if (a === 'info') {
  if (process.env['FAKE_DOCKER_DOWN'] === '1') fail('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?')
  out('27.0.1')
} else if (a === 'ps') out(load().map((/** @type {any} */ c) => JSON.stringify(c)).join('\n'))
else if (a === 'images') {
  out(JSON.stringify({ ID: 'sha-nginx', Repository: 'nginx', Tag: '1', Size: '187MB', CreatedSince: '2 weeks ago' }))
  out(JSON.stringify({ ID: 'sha-redis', Repository: 'redis', Tag: '7', Size: '117MB', CreatedSince: '3 weeks ago' }))
} else if (['start', 'stop', 'restart', 'pause', 'unpause'].includes(a)) {
  const next = { start: ['running', 'Up 1 second'], restart: ['running', 'Up 1 second'], unpause: ['running', 'Up 1 second'], stop: ['exited', 'Exited (0) 1 second ago'], pause: ['paused', 'Up 1 minute (Paused)'] }[a]
  save(load().map((/** @type {any} */ c) => (c.Names === b ? { ...c, State: next[0], Status: next[1] } : c)))
  out(b)
} else if (a === 'rm') {
  save(load().filter((/** @type {any} */ c) => c.Names !== args[2]))
  out(args[2])
} else if (a === 'rmi') out(`Untagged: ${b}`)
else if (a === 'logs') {
  process.stdout.write('log line 1\n')
  process.stderr.write('warn line\n')
} else fail(`fake docker: unexpected arguments ${JSON.stringify(args)}`)
