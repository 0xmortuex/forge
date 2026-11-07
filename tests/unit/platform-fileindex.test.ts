import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FileIndex, scorePath, type IndexState } from '../../src/main/platform/fileindex'

async function project(files: string[]): Promise<{ root: string; snap: string; done: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'forge-idx-'))
  const root = join(dir, 'proj')
  for (const f of files) {
    await mkdir(join(root, f, '..'), { recursive: true })
    await writeFile(join(root, f), 'x')
  }
  return { root, snap: join(dir, 'cache', 'index.json'), done: () => rm(dir, { recursive: true, force: true }) }
}

const rel = (root: string, path: string): string => path.slice(root.length + 1).replace(/\\/g, '/')

test('scoring prefers exact, then prefix, then substring, then subsequence in the name, then the path', () => {
  const s = (r: string, q: string): number => scorePath(r, q)
  assert.ok(s('src/main.ts', 'main.ts') > s('src/main.tsx', 'main.ts'))
  assert.ok(s('src/main.tsx', 'main') > s('src/domain.ts', 'main'))
  assert.ok(s('src/domain.ts', 'main') > s('src/mxaxixn.ts', 'main'))
  assert.ok(s('src/mxaxixn.ts', 'main') > s('m/a/i/n.ts', 'main'))
  assert.equal(s('src/a.ts', 'zzz'), 0)
})

test('open indexes the project and queries are ranked', async () => {
  const p = await project(['src/main.ts', 'src/domain.ts', 'README.md', 'node_modules/x/main.js'])
  try {
    const idx = new FileIndex()
    const { files } = await idx.open(p.root)
    assert.equal(files, 3) // node_modules is skipped by the walker
    assert.deepEqual(idx.query('main').map((h) => rel(p.root, h.path)), ['src/main.ts', 'src/domain.ts'])
    assert.equal(idx.state(), 'ready')
  } finally {
    await p.done()
  }
})

test('state goes indexing then ready', async () => {
  const p = await project(['a.txt'])
  try {
    const seen: IndexState[] = []
    await new FileIndex({ onState: (s) => void seen.push(s) }).open(p.root)
    assert.deepEqual(seen, ['indexing', 'indexing', 'ready'])
  } finally {
    await p.done()
  }
})

test('watcher changes add and remove files, folders included', async () => {
  const p = await project(['a.ts', 'dir/b.ts', 'dir/c.ts'])
  try {
    const idx = new FileIndex()
    await idx.open(p.root)
    await writeFile(join(p.root, 'new.ts'), 'x')
    await rm(join(p.root, 'dir'), { recursive: true })
    await idx.changed([join(p.root, 'new.ts'), join(p.root, 'dir')])
    assert.deepEqual(idx.query('').map((h) => rel(p.root, h.path)).sort(), ['a.ts', 'new.ts'])
  } finally {
    await p.done()
  }
})

test('the snapshot answers before the rescan finishes and survives a restart', async () => {
  const p = await project(['a.ts', 'b.ts'])
  try {
    await new FileIndex({ snapshotPath: p.snap }).open(p.root)
    let release!: () => void
    const gate = new Promise<void>((ok) => (release = ok))
    const second = new FileIndex({
      snapshotPath: p.snap,
      walk: async (_r, onFile) => {
        await gate
        onFile(join(p.root, 'a.ts'))
      }
    })
    const opening = second.open(p.root)
    await new Promise((ok) => setTimeout(ok, 50))
    assert.equal(second.state(), 'indexing')
    assert.equal(second.query('').length, 2, 'cached files are queryable while rescanning')
    release()
    await opening
    assert.equal(second.query('').length, 1, 'the rescan dropped the file that vanished while closed')
  } finally {
    await p.done()
  }
})

test('a corrupt or foreign-version snapshot is an explicit error', async () => {
  const p = await project(['a.ts'])
  try {
    await mkdir(join(p.snap, '..'), { recursive: true })
    await writeFile(p.snap, '{nope')
    await assert.rejects(new FileIndex({ snapshotPath: p.snap }).open(p.root), /is corrupt/)
    await writeFile(p.snap, JSON.stringify({ version: 99, root: p.root, files: [] }))
    await assert.rejects(new FileIndex({ snapshotPath: p.snap }).open(p.root), /has version 99/)
  } finally {
    await p.done()
  }
})

test('changed() before open() is an error', async () => {
  await assert.rejects(new FileIndex().changed(['x']), /no project open/)
})

test('many concurrent changes write the snapshot safely and leave no temporary file', async () => {
  const p = await project(['a.ts'])
  try {
    const idx = new FileIndex({ snapshotPath: p.snap })
    await idx.open(p.root)
    const added: string[] = []
    for (let i = 0; i < 25; i++) {
      const f = join(p.root, `f${i}.ts`)
      await writeFile(f, 'x')
      added.push(f)
    }
    await Promise.all(added.map((f) => idx.changed([f])))
    const { readdir, readFile } = await import('node:fs/promises')
    assert.deepEqual(await readdir(join(p.snap, '..')), ['index.json'])
    assert.equal((JSON.parse(await readFile(p.snap, 'utf8')) as { files: string[] }).files.length, 26)
  } finally {
    await p.done()
  }
})

test('list() returns every indexed file and follows watcher changes', async () => {
  const p = await project(['a.ts', 'sub/b.ts'])
  try {
    const idx = new FileIndex()
    await idx.open(p.root)
    assert.deepEqual(idx.list().map((f) => rel(p.root, f)).sort(), ['a.ts', 'sub/b.ts'])
    await rm(join(p.root, 'a.ts'))
    await idx.changed([join(p.root, 'a.ts')])
    assert.deepEqual(idx.list().map((f) => rel(p.root, f)), ['sub/b.ts'])
  } finally {
    await p.done()
  }
})

test('searchText finds lines across the project and short queries are an error', async () => {
  const p = await project(['src/a.ts', 'src/b.ts'])
  try {
    await writeFile(join(p.root, 'src', 'a.ts'), 'const Greeting = "hello world"\nother\n')
    await writeFile(join(p.root, 'src', 'b.ts'), 'nothing\nsay HELLO again\n')
    const idx = new FileIndex()
    await idx.open(p.root)
    const hits = await idx.searchText('hello')
    assert.deepEqual(hits.map((h) => `${rel(p.root, h.path)}:${h.line}`).sort(), ['src/a.ts:1', 'src/b.ts:2'])
    await assert.rejects(idx.searchText('he'), /at least 3 characters/)
  } finally {
    await p.done()
  }
})

test('the text index follows watcher changes: edits, new files and removed folders', async () => {
  const p = await project(['src/a.ts', 'keep/k.ts'])
  try {
    await writeFile(join(p.root, 'src', 'a.ts'), 'first version\n')
    const idx = new FileIndex()
    await idx.open(p.root)
    assert.equal((await idx.searchText('first version')).length, 1)
    await writeFile(join(p.root, 'src', 'a.ts'), 'second version\n')
    await writeFile(join(p.root, 'src', 'new.ts'), 'brand new text\n')
    await idx.changed([join(p.root, 'src', 'a.ts'), join(p.root, 'src', 'new.ts')])
    assert.equal((await idx.searchText('first version')).length, 0)
    assert.equal((await idx.searchText('second version')).length, 1)
    assert.equal((await idx.searchText('brand new')).length, 1)
    await rm(join(p.root, 'src'), { recursive: true })
    await idx.changed([join(p.root, 'src')])
    assert.equal((await idx.searchText('second version')).length, 0)
  } finally {
    await p.done()
  }
})

test('binary files are listed as skipped, not searched', async () => {
  const p = await project(['text.txt', 'blob.bin'])
  try {
    await writeFile(join(p.root, 'text.txt'), 'needle in a haystack\n')
    await writeFile(join(p.root, 'blob.bin'), Buffer.from('needle\0\0binary'))
    const idx = new FileIndex()
    await idx.open(p.root)
    assert.deepEqual((await idx.searchText('needle')).map((h) => rel(p.root, h.path)), ['text.txt'])
    const stats = idx.textStats()
    assert.equal(stats.files, 1)
    assert.deepEqual(stats.skipped.map((s) => `${rel(p.root, s.path)}=${s.reason}`), ['blob.bin=binary'])
  } finally {
    await p.done()
  }
})

test('opening another project leaves nothing of the first one searchable', async () => {
  const one = await project(['a.txt'])
  const two = await project(['b.txt'])
  try {
    await writeFile(join(one.root, 'a.txt'), 'only in project one\n')
    await writeFile(join(two.root, 'b.txt'), 'only in project two\n')
    const idx = new FileIndex()
    await idx.open(one.root)
    assert.equal((await idx.searchText('project one')).length, 1)
    await idx.open(two.root)
    assert.equal((await idx.searchText('project one')).length, 0)
    assert.equal((await idx.searchText('project two')).length, 1)
  } finally {
    await one.done()
    await two.done()
  }
})

test('a file that changes while the text index is still being built is not left stale', async () => {
  const p = await project(['a.txt'])
  try {
    const target = join(p.root, 'a.txt')
    let current = 'old content\n'
    let release!: () => void
    const gate = new Promise<void>((ok) => (release = ok))
    let firstRead = true
    const idx = new FileIndex({
      readText: async (path) => {
        const seen = current // read before the gate: this is the stale text the build holds
        if (path === target && firstRead) {
          firstRead = false
          await gate
        }
        return seen
      }
    })
    await idx.open(p.root) // returns once the file list is final; the text build is blocked on the gate
    assert.equal(idx.textStats().building, true)
    current = 'new content\n'
    await idx.changed([target])
    release()
    assert.equal((await idx.searchText('new content')).length, 1)
    assert.equal((await idx.searchText('old content')).length, 0)
  } finally {
    await p.done()
  }
})

test('searchText before a project is open is an error', async () => {
  await assert.rejects(new FileIndex().searchText('anything'), /no project open/)
})

test('completeWord offers the identifiers of the project and follows watcher changes', async () => {
  const p = await project(['a.ts', 'b.ts'])
  try {
    await writeFile(join(p.root, 'a.ts'), 'const frobnicateWidget = 1\nfrobnicateWidget + frobnicateGadget\n')
    await writeFile(join(p.root, 'b.ts'), 'export const frobulator = 2\n')
    const idx = new FileIndex()
    await idx.open(p.root)
    await idx.searchText('frob') // waits for the text/word build
    assert.deepEqual((await idx.completeWord('frob')).map((w) => w.word), ['frobnicateWidget', 'frobulator', 'frobnicateGadget'])
    await writeFile(join(p.root, 'b.ts'), 'export const frobulator = 2\nfrobulatorTwo()\n')
    await idx.changed([join(p.root, 'b.ts')])
    assert.ok((await idx.completeWord('frobulator')).some((w) => w.word === 'frobulatorTwo'))
    await assert.rejects(idx.completeWord('f'), /at least 2 characters/)
  } finally {
    await p.done()
  }
})

test('completeWord before a project is open is an error', async () => {
  await assert.rejects(new FileIndex().completeWord('abc'), /no project open/)
})
