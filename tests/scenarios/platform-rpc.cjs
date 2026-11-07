// @ts-check
// The backend platform end to end: the typed RPC channel reaches the lazily activated file-index module, the module
// keeps its index current from the file watcher, state changes arrive as events, and bad requests fail loudly.
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const { run } = require('../harness.cjs')

run('platform-rpc', { 'src/alpha.ts': 'a\n', 'src/beta.ts': 'b\n', 'README.md': 'r\n' }, async (t) => {
  const { js, key, check, sleep, waitFor, root } = t
  const rpc = (/** @type {string} */ service, /** @type {string} */ method, /** @type {unknown[]} */ args = []) =>
    js(`window.forge.rpc(${JSON.stringify({ service, method, args })})`)
  const names = (/** @type {{ path: string }[]} */ hits) => hits.map((h) => path.relative(root, h.path).replace(/\\/g, '/'))

  // The window must have the project open so the watcher is running.
  key('O', ['control'])
  await waitFor(async () => (await js("document.getElementById('tree').textContent")).includes('README.md'), 5000)

  await js(`window.__events = []; window.forge.onRpcEvent((topic, payload) => window.__events.push([topic, payload])); undefined`)
  const opened = await rpc('fileindex', 'open', [root])
  check('open() indexes the project through the RPC channel', opened.ok && opened.value.files === 3, JSON.stringify(opened))

  const found = await rpc('fileindex', 'query', ['beta'])
  check('query() finds a file by name', found.ok && names(found.value)[0] === 'src/beta.ts', JSON.stringify(found))

  const listed = await rpc('fileindex', 'list')
  const listedNames = names(/** @type {string[]} */ (listed.value ?? []).map((p) => ({ path: p }))).sort().join()
  check('list() returns every file', listed.ok && listedNames === 'README.md,src/alpha.ts,src/beta.ts', JSON.stringify(listed))

  const events = await js('window.__events.filter((e) => e[0] === "fileindex.state").map((e) => e[1])')
  check('state events reach the window (indexing, then ready)', events[0] === 'indexing' && events[events.length - 1] === 'ready', JSON.stringify(events))

  fs.writeFileSync(path.join(root, 'src', 'gamma.ts'), 'g\n')
  const seen = await waitFor(async () => {
    const r = await rpc('fileindex', 'query', ['gamma'])
    return r.ok && r.value.length === 1
  }, 8000)
  check('a file created outside Forge shows up through the watcher', !!seen)

  fs.rmSync(path.join(root, 'src', 'alpha.ts'))
  const gone = await waitFor(async () => (await rpc('fileindex', 'query', ['alpha'])).value.length === 0, 8000)
  check('a deleted file leaves the index', !!gone)

  const dir = path.join(t.userData, 'index')
  const settled = await waitFor(() => {
    const f = fs.readdirSync(dir)
    return f.length === 1 && f[0]?.endsWith('.json') ? f : null
  }, 5000)
  check('one snapshot is stored in the user-data folder and no temporary file is left', !!settled, String(fs.readdirSync(dir)))

  const dict = await rpc('spell', 'dictionary')
  check('the spell service (a migrated module) serves the dictionary', dict.ok && dict.value.aff.length > 1000 && dict.value.dic.length > 1000, JSON.stringify(dict).slice(0, 120))

  const file = path.join(root, 'src', 'beta.ts')
  const V1 = 'version one' + String.fromCharCode(10)
  const added = await rpc('history', 'add', [file, V1])
  const again = await rpc('history', 'add', [file, V1])
  const listedHist = await rpc('history', 'list', [file])
  const readBack = listedHist.ok && listedHist.value[0] ? await rpc('history', 'read', [file, listedHist.value[0].id]) : { ok: false }
  check('history: add stores a snapshot, an identical one is skipped, list/read return it',
    added.value === true && again.value === false && listedHist.value.length === 1 && readBack.value === V1, JSON.stringify([added, again, listedHist, readBack]))
  const badId = await rpc('history', 'read', [file, '../../x'])
  check('history: an id that tries to leave the folder is refused', !badId.ok && /Invalid history entry/.test(badId.error), JSON.stringify(badId))

  const sc1 = await rpc('scratch', 'create', ['txt'])
  const sc2 = await rpc('scratch', 'create', ['txt'])
  const scList = await rpc('scratch', 'list')
  check('scratch: create numbers new files and list returns them', sc1.ok && sc2.ok && sc1.value !== sc2.value && scList.value.includes(sc1.value) && scList.value.includes(sc2.value), JSON.stringify([sc1, sc2, scList]))
  const badExt = await rpc('scratch', 'create', ['../x'])
  check('scratch: an invalid extension is an error', !badExt.ok && /Invalid file extension/.test(badExt.error), JSON.stringify(badExt))

  // Streaming: terminal output and exits arrive as bus events. A console `node` from PATH is the child (the electron
  // executable is a GUI-subsystem program on Windows and is not a reliable thing to run inside a pseudo-console).
  const asNode = { file: 'node' }
  const events4 = (/** @type {number} */ id, /** @type {string} */ topic) => js(`window.__events.filter((e) => e[0] === ${JSON.stringify(topic)} && e[1].id === ${id}).map((e) => e[1])`)
  const quick = await rpc('terminal', 'create', [root, 80, 24, { ...asNode, args: ['-e', "console.log('hi-' + 'term'); setTimeout(() => {}, 1500)"] }])
  check('terminal: create returns an id', quick.ok && typeof quick.value === 'number', JSON.stringify(quick))
  const outSeen = await waitFor(async () => (await events4(quick.value, 'term.data')).some((/** @type {{ data: unknown }} */ e) => String(e.data).includes('hi-term')), 15000)
  check('terminal: the program output arrives as term.data events', !!outSeen, JSON.stringify(await events4(quick.value, 'term.data')))
  const exited = await waitFor(async () => (await events4(quick.value, 'term.exit'))[0], 15000)
  check('terminal: the exit arrives as a term.exit event with code 0', !!exited && exited.code === 0, JSON.stringify(exited))

  const long = await rpc('terminal', 'create', [root, 80, 24, { ...asNode, args: ['-e', 'setInterval(() => {}, 1000)'] }])
  const killed = await rpc('terminal', 'kill', [long.value])
  const longExit = await waitFor(async () => (await events4(long.value, 'term.exit'))[0], 15000)
  check('terminal: kill ends a running program and reports its exit', killed.ok && !!longExit, JSON.stringify([killed, longExit]))
  const noTerm = await rpc('terminal', 'write', [987654, 'x'])
  check('terminal: writing to an unknown terminal is an error', !noTerm.ok && /No terminal with id 987654/.test(noTerm.error), JSON.stringify(noTerm))

  // Validation runs before any external program (docker, gh) is started, so these need neither installed.
  const emptyComment = await rpc('github', 'comment', [root, 1, '   '])
  check('github: an empty comment is refused', !emptyComment.ok && /The comment is empty/.test(emptyComment.error), JSON.stringify(emptyComment))
  const noTitle = await rpc('github', 'create', [root, { title: ' ', body: '' }])
  check('github: a pull request without a title is refused', !noTitle.ok && /needs a title/.test(noTitle.error), JSON.stringify(noTitle))
  const badImage = await rpc('docker', 'removeImage', [root, 'bad id; rm -rf /'])
  check('docker: an image id with shell characters is refused', !badImage.ok && /Not an image id or name/.test(badImage.error), JSON.stringify(badImage))
  const noDb = await rpc('database', 'query', [path.join(root, 'none.db'), 'select 1'])
  // query() re-opens a database that is not open (that is how it recovers after Stop), so a missing file reports the file error.
  check('database: querying a file that does not exist reports the file error', !noDb.ok && /ENOENT/.test(noDb.error), JSON.stringify(noDb))

  const loaded = await rpc('settings', 'load')
  check('settings: load returns the user-data folder and parsed settings', loaded.ok && fs.realpathSync.native(loaded.value.dir) === fs.realpathSync.native(t.userData) && typeof loaded.value.settings === 'object' && Array.isArray(loaded.value.errors), JSON.stringify(loaded).slice(0, 200))
  const badSettings = await rpc('settings', 'save', ['this is not json'])
  check('settings: text that cannot be read back is refused, not written', !badSettings.ok && /Settings to save/.test(badSettings.error), JSON.stringify(badSettings))
  const extList = await rpc('extensions', 'list')
  check('extensions: list returns an array', extList.ok && Array.isArray(extList.value), JSON.stringify(extList))
  const badExtId = await rpc('extensions', 'dataLoad', ['../escape'])
  check('extensions: an invalid extension id is refused', !badExtId.ok && /Not a valid extension id/.test(badExtId.error), JSON.stringify(badExtId))
  const noNet = await rpc('extensions', 'fetch', ['ghost-ext', { method: 'GET', url: 'http://127.0.0.1:1/', headers: {} }])
  check('extensions: fetch needs the network permission', !noNet.ok && /has not asked for the "network" permission/.test(noNet.error), JSON.stringify(noNet))

  // git: a real repository built here, with a local identity (CI runners have none).
  const repo = path.join(root, 'repo')
  fs.mkdirSync(repo)
  const g = (/** @type {string[]} */ ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.name', 'Forge Test')
  g('config', 'user.email', 'test@example.com')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one' + String.fromCharCode(10))
  g('add', 'a.txt')
  g('commit', '-q', '-m', 'first')
  const clean = await rpc('git', 'status', [repo])
  check('git: status of a clean repository', clean.ok && clean.value.branch === 'main' && clean.value.changes.length === 0, JSON.stringify(clean).slice(0, 200))
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two' + String.fromCharCode(10))
  const dirty = await rpc('git', 'status', [repo])
  check('git: status reports a modified file', dirty.ok && dirty.value.changes.length === 1 && dirty.value.changes[0].kind === 'modified', JSON.stringify(dirty).slice(0, 200))
  const noMsg = await rpc('git', 'commit', [repo, '  ', [path.join(repo, 'a.txt')]])
  check('git: a commit without a message is refused', !noMsg.ok && /Commit message is empty/.test(noMsg.error), JSON.stringify(noMsg))
  const committed = await rpc('git', 'commit', [repo, 'second', [path.join(repo, 'a.txt')]])
  const log = await rpc('git', 'log', [repo, { limit: 5 }])
  check('git: commit then log shows both commits, newest first', committed.ok && log.ok && log.value.map((/** @type {{ subject: string }} */ c) => c.subject).join() === 'second,first', JSON.stringify([committed, log]).slice(0, 240))
  await rpc('git', 'createBranch', [repo, 'feature'])
  const branches = await rpc('git', 'branches', [repo])
  check('git: createBranch then branches lists it', branches.ok && branches.value.includes('feature') && branches.value.includes('main'), JSON.stringify(branches))
  const notRepo = await rpc('git', 'branches', [path.join(root, 'src')])
  check('git: asking about a folder that is not a repository is an error', !notRepo.ok, JSON.stringify(notRepo))

  // files: the project's file operations
  const ft = path.join(root, 'ft')
  const f = (/** @type {string} */ name) => path.join(ft, name)
  const mk = await rpc('files', 'createDir', [ft])
  const mkAgain = await rpc('files', 'createDir', [ft])
  check('files: createDir makes a folder and refuses to repeat', mk.ok && !mkAgain.ok, JSON.stringify([mk, mkAgain]))
  const w = await rpc('files', 'writeFile', [f('a.txt'), 'hello'])
  const rdBack = await rpc('files', 'readFile', [f('a.txt')])
  check('files: writeFile then readFile round-trips', w.ok && rdBack.value === 'hello', JSON.stringify([w, rdBack]))
  const enc = await rpc('files', 'writeFileEnc', [f('l1.txt'), 'caf' + String.fromCharCode(233), 'iso-8859-1'])
  const encBack = await rpc('files', 'readFileEnc', [f('l1.txt'), 'iso-8859-1'])
  check('files: writeFileEnc/readFileEnc keep the encoding', enc.ok && encBack.ok && encBack.value.text === 'caf' + String.fromCharCode(233) && encBack.value.encoding === 'iso-8859-1', JSON.stringify([enc, encBack]))
  const ex1 = await rpc('files', 'exists', [f('a.txt')])
  const ex2 = await rpc('files', 'exists', [f('nope.txt')])
  check('files: exists says yes and no', ex1.value === true && ex2.value === false, JSON.stringify([ex1, ex2]))
  const cf1 = await rpc('files', 'createFile', [f('b.txt')])
  const cf2 = await rpc('files', 'createFile', [f('b.txt')])
  check('files: createFile never overwrites', cf1.ok && !cf2.ok, JSON.stringify([cf1, cf2]))
  const rnOver = await rpc('files', 'rename', [f('b.txt'), f('a.txt')])
  check('files: rename onto an existing file is refused', !rnOver.ok && /Already exists/.test(rnOver.error), JSON.stringify(rnOver))
  const rn = await rpc('files', 'rename', [f('b.txt'), f('c.txt')])
  check('files: rename to a free name works', rn.ok && (await rpc('files', 'exists', [f('c.txt')])).value === true && (await rpc('files', 'exists', [f('b.txt')])).value === false, JSON.stringify(rn))
  await rpc('files', 'createDir', [f('sub')])
  const cp1 = await rpc('files', 'copy', [f('sub'), f('sub2')])
  const cp2 = await rpc('files', 'copy', [f('a.txt'), f('c.txt')])
  check('files: copy works and never overwrites', cp1.ok && !cp2.ok, JSON.stringify([cp1, cp2]))
  const ftList = await rpc('files', 'readDir', [ft])
  const order = ftList.ok ? ftList.value.map((/** @type {{ name: string, isDir: boolean }} */ e) => (e.isDir ? '/' : '') + e.name).join() : ''
  check('files: readDir lists folders first, then files by name', order === '/sub,/sub2,a.txt,c.txt,l1.txt', order)
  const bytes = await rpc('files', 'readBytes', [f('a.txt'), 1, 3])
  check('files: readBytes returns the requested slice and the size', bytes.ok && bytes.value.size === 5 && bytes.value.data.length === 3, JSON.stringify(bytes).slice(0, 160))
  const real = await rpc('files', 'realpath', [ft])
  check('files: realpath returns the real path', real.ok && fs.realpathSync.native(ft) === real.value, JSON.stringify(real))
  const notImg = await rpc('files', 'readDataUrl', [f('a.txt')])
  check('files: readDataUrl refuses a non-image', !notImg.ok && /Not an image type/.test(notImg.error), JSON.stringify(notImg))
  const hit = await rpc('files', 'search', [ft, 'hello'])
  check('files: search finds text in the project', hit.ok && JSON.stringify(hit.value).includes('a.txt'), JSON.stringify(hit).slice(0, 200))
  const refs = await rpc('files', 'references', [root, f('a.txt')])
  check('files: references returns hits, a file count and a truncated flag', refs.ok && Array.isArray(refs.value.hits) && typeof refs.value.files === 'number' && refs.value.truncated === false, JSON.stringify(refs).slice(0, 200))
  const listed2 = await rpc('files', 'listFiles', [ft])
  check('files: listFiles walks the folder', listed2.ok && listed2.value.length >= 3, JSON.stringify(listed2).slice(0, 200))

  const server = http.createServer((_req, res) => res.end('pong'))
  await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(undefined)))
  const url = 'http://127.0.0.1:' + /** @type {import('node:net').AddressInfo} */ (server.address()).port + '/'
  const sent = await rpc('http', 'send', [{ method: 'GET', url, headers: {} }])
  check('http: send performs a real request and returns the response', sent.ok && sent.value.status === 200 && sent.value.body === 'pong', JSON.stringify(sent))
  server.close()
  const badMethod = await rpc('http', 'send', [{ method: 'FETCH', url, headers: {} }])
  check('http: an unsupported method is an error', !badMethod.ok && /Unsupported HTTP method/.test(badMethod.error), JSON.stringify(badMethod))

  // Two files that share a 12-line block of real code.
  const block = Array.from({ length: 12 }, (_, i) => 'const value' + i + ' = compute(' + i + ', "x")').join(String.fromCharCode(10)) + String.fromCharCode(10)
  fs.mkdirSync(path.join(root, 'dup'), { recursive: true })
  fs.writeFileSync(path.join(root, 'dup', 'one.ts'), block + 'export const one = 1' + String.fromCharCode(10))
  fs.writeFileSync(path.join(root, 'dup', 'two.ts'), 'export const two = 2' + String.fromCharCode(10) + block)
  const dup = await rpc('duplicates', 'find', [root, 6])
  check('duplicates: find reports the shared block', dup.ok && dup.value.filesScanned >= 2 && dup.value.groups.length >= 1, JSON.stringify(dup).slice(0, 200))
  const deps = await rpc('deps', 'analyse', [root])
  check('deps: analyse returns a graph and cycles', deps.ok && !!deps.value.graph && Array.isArray(deps.value.cycles), JSON.stringify(deps).slice(0, 160))
  const fw = await rpc('tests', 'detect', [root])
  check('tests: detect finds no framework in a bare project', fw.ok && Array.isArray(fw.value) && fw.value.length === 0, JSON.stringify(fw))
  const pk = await rpc('npm', 'packages', [root])
  check('npm: packages finds no package.json in a bare project', pk.ok && Array.isArray(pk.value) && pk.value.length === 0, JSON.stringify(pk))

  const ghost = await rpc('nope', 'x')
  check('an unknown service is an error response', !ghost.ok && /No module provides the service "nope"/.test(ghost.error), JSON.stringify(ghost))
  const hidden = await rpc('fileindex', 'constructor')
  check('constructor is not callable', !hidden.ok, JSON.stringify(hidden))
  await sleep(50)
})
