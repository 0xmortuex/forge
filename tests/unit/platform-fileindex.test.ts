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
