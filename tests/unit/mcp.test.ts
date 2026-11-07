import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'
import { FilesService } from '../../src/main/files'
import { GitService } from '../../src/main/git'
import { FileIndex } from '../../src/main/platform/fileindex'
import { McpServer, projectTools } from '../../src/mcp/server'

let base = ''
let root = ''
let outside = ''
let server: McpServer
const nl = String.fromCharCode(10)

before(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'forge-mcp-')))
  root = join(base, 'project')
  outside = join(base, 'outside')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(outside, 'secret.txt'), 'top secret' + nl)
  writeFileSync(join(root, 'src', 'main.ts'), ['export function greet() {', '  return "Hello MCP"', '}', ''].join(nl))
  writeFileSync(join(root, 'README.md'), 'a readme' + nl)
  writeFileSync(join(root, 'blob.bin'), Buffer.from('bin\0ary'))
  writeFileSync(join(root, 'long.txt'), Array.from({ length: 30000 }, (_, i) => 'line number ' + i).join(nl) + nl)
  const git = (...a: string[]): string => execFileSync('git', a, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.com')
  git('add', '.')
  git('commit', '-q', '-m', 'initial commit')
  writeFileSync(join(root, 'README.md'), 'a changed readme' + nl)
  const index = new FileIndex()
  await index.open(root)
  server = new McpServer(projectTools({ root, index, files: new FilesService(), git: new GitService() }))
})
after(() => rmSync(base, { recursive: true, force: true }))

type Reply = { id: unknown; result?: any; error?: { code: number; message: string } }
let nextId = 1
const call = async (method: string, params?: unknown): Promise<Reply> => JSON.parse((await server.handle(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }))) as string) as Reply
const tool = async (name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> => {
  const r = await call('tools/call', { name, arguments: args })
  assert.equal(r.error, undefined, JSON.stringify(r))
  return { text: r.result.content[0].text as string, isError: r.result.isError === true }
}

test('initialize answers with the client protocol version when supported, the latest otherwise', async () => {
  const ok = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } })
  assert.equal(ok.result.protocolVersion, '2024-11-05')
  assert.equal(ok.result.serverInfo.name, 'forge')
  assert.deepEqual(Object.keys(ok.result.capabilities), ['tools'])
  assert.equal((await call('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18')
})

test('notifications get no answer (even unknown ones); ping answers {}', async () => {
  assert.equal(await server.handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), null)
  assert.equal(await server.handle(JSON.stringify({ jsonrpc: '2.0', method: 'something/unknown' })), null)
  assert.deepEqual((await call('ping')).result, {})
})

test('protocol errors carry the standard codes', async () => {
  assert.equal((await call('no/such/method')).error?.code, -32601)
  const parse = JSON.parse((await server.handle('{not json')) as string) as Reply
  assert.equal(parse.error?.code, -32700)
  assert.equal(parse.id, null)
  assert.equal(JSON.parse((await server.handle('[]')) as string).error.code, -32600)
  assert.equal(JSON.parse((await server.handle(JSON.stringify({ id: 1, method: 'ping' }))) as string).error.code, -32600)
  assert.equal((await call('tools/call', { name: 'nope' })).error?.code, -32602)
  assert.equal((await call('tools/call', { name: 'find_files', arguments: [] })).error?.code, -32602)
})

test('the tool list is read-only: nothing that writes, deletes or runs commands', async () => {
  const { tools } = (await call('tools/list')).result as { tools: { name: string; inputSchema: { type: string } }[] }
  assert.deepEqual(tools.map((t) => t.name).sort(), ['find_files', 'git_log', 'git_status', 'list_directory', 'read_file', 'search_text'])
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object')
    assert.doesNotMatch(t.name, /write|edit|delete|remove|exec|run|shell|terminal|create/)
  }
})

test('find_files and search_text use the project index', async () => {
  assert.match((await tool('find_files', { query: 'main' })).text, /^src\/main\.ts$/m)
  assert.equal((await tool('find_files', { query: 'zzzzqqqq' })).text, 'No file matches.')
  const hit = await tool('search_text', { query: 'hello mcp' })
  assert.equal(hit.text, 'src/main.ts:2: return "Hello MCP"')
  assert.equal((await tool('search_text', { query: 'surely-not-present' })).text, 'No matches.')
})

test('read_file returns numbered lines, honours a line range, and refuses binaries and folders', async () => {
  const all = await tool('read_file', { path: 'src/main.ts' })
  assert.equal(all.text.split(nl)[1], '2\t  return "Hello MCP"')
  assert.equal((await tool('read_file', { path: 'src/main.ts', startLine: 2, endLine: 2 })).text, '2\t  return "Hello MCP"')
  const bin = await tool('read_file', { path: 'blob.bin' })
  assert.ok(bin.isError && /binary/.test(bin.text))
  const dir = await tool('read_file', { path: 'src' })
  assert.ok(dir.isError && /not a file/.test(dir.text))
  const bad = await tool('read_file', { path: 'src/main.ts', startLine: 3, endLine: 1 })
  assert.ok(bad.isError && /endLine/.test(bad.text))
})

test('a very long file is cut at the size limit with a note on where to continue', async () => {
  const r = await tool('read_file', { path: 'long.txt' })
  assert.match(r.text, /\.\.\. cut at 200 KB; continue with startLine \d+$/)
  assert.ok(Buffer.byteLength(r.text) < 210 * 1024)
})

test('list_directory lists folders first and defaults to the root', async () => {
  const top = (await tool('list_directory')).text.split(nl)
  assert.ok(top.includes('src/'))
  assert.ok(top.includes('README.md'))
  assert.ok(top.indexOf('src/') < top.indexOf('README.md'), 'folders come before files')
  assert.equal((await tool('list_directory', { path: 'src' })).text, 'main.ts')
})

test('git_status and git_log reflect the repository', async () => {
  const st = (await tool('git_status')).text
  assert.match(st, /^branch main/)
  assert.match(st, /modified\tREADME\.md/)
  assert.match((await tool('git_log', { limit: 5 })).text, /^[0-9a-f]{8} \d{4}-\d{2}-\d{2} Test: initial commit$/m)
})

test('paths outside the project are refused, relative, absolute or through ..', async () => {
  for (const p of ['../outside/secret.txt', join(outside, 'secret.txt'), '..', 'src/../../outside/secret.txt']) {
    const r = await tool('read_file', { path: p })
    assert.ok(r.isError, `${p} should be refused`)
    assert.match(r.text, /outside the project/)
    assert.doesNotMatch(r.text, /top secret/)
  }
  assert.ok((await tool('list_directory', { path: '..' })).isError)
})

test('a link inside the project that points outside cannot be used to escape', async (t) => {
  try {
    symlinkSync(outside, join(root, 'escape'), 'junction')
  } catch (err) {
    return t.skip(`cannot create a link here: ${(err as Error).message}`)
  }
  const r = await tool('read_file', { path: 'escape/secret.txt' })
  assert.ok(r.isError)
  assert.match(r.text, /leads outside the project/)
  assert.doesNotMatch(r.text, /top secret/)
  assert.ok((await tool('list_directory', { path: 'escape' })).isError)
})

test('bad arguments are reported to the model as tool errors it can read', async () => {
  for (const [name, args, msg] of [
    ['search_text', {}, /"query" must be a non-empty string/],
    ['search_text', { query: 'abc', limit: -1 }, /positive whole number/],
    ['search_text', { query: 'ab' }, /at least 3 characters/],
    ['read_file', {}, /"path" must be a non-empty string/]
  ] as const) {
    const r = await tool(name, args)
    assert.ok(r.isError, name)
    assert.match(r.text, msg)
  }
})

// ---- the real process, over stdio

const forgeRoot = join(__dirname, '..', '..')
function runServer(args: string[], input: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(forgeRoot, 'src', 'mcp', 'main.ts'), ...args], { cwd: forgeRoot })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    for (const line of input) child.stdin.write(line + nl)
    child.stdin.end()
  })
}

test('the real server process answers over stdio and writes nothing else to stdout', async () => {
  const msg = (id: number | undefined, method: string, params?: unknown): string => JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params })
  const run = await runServer(['--root', root], [
    msg(1, 'initialize', { protocolVersion: '2025-06-18' }),
    msg(undefined, 'notifications/initialized'),
    msg(2, 'tools/call', { name: 'search_text', arguments: { query: 'hello mcp' } }),
    'this line is not json',
    msg(3, 'tools/list')
  ])
  assert.equal(run.code, 0, run.stderr)
  const replies = run.stdout.split(nl).filter(Boolean).map((l) => JSON.parse(l) as Reply) // every stdout line must be JSON
  assert.equal(replies.length, 4, 'three requests and one parse error; the notification gets no answer')
  const byId = new Map(replies.map((r) => [r.id, r]))
  assert.equal(byId.get(1)?.result.serverInfo.name, 'forge')
  assert.equal(byId.get(2)?.result.content[0].text, 'src/main.ts:2: return "Hello MCP"')
  assert.equal(byId.get(3)?.result.tools.length, 6)
  assert.equal(byId.get(null)?.error?.code, -32700)
  assert.match(run.stderr, /forge-mcp: serving .* \(\d+ files\)/)
})

test('starting without a usable --root fails with a message and a non-zero exit, and prints nothing to stdout', async () => {
  for (const args of [[], ['--root'], ['--root', join(base, 'does-not-exist')], ['--root', join(root, 'README.md')]]) {
    const run = await runServer(args, [])
    assert.equal(run.code, 1, JSON.stringify(args))
    assert.match(run.stderr, /forge-mcp: /)
    assert.equal(run.stdout, '')
  }
})
