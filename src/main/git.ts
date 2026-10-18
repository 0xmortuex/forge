import { execFile } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { ipcMain } from 'electron'

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface GitChange {
  path: string // absolute
  kind: ChangeKind
}

export interface GitStatus {
  branch: string // branch name, or short commit when detached
  detached: boolean
  upstream: string | null // e.g. "origin/main"
  ahead: number
  behind: number
  changes: GitChange[]
}

export interface StashEntry {
  ref: string // stash@{0}
  message: string
}

export interface BlameLine {
  sha: string
  author: string
  time: number // unix seconds; 0 for uncommitted
  summary: string
}

interface Repo {
  top: string // repository top-level directory
}

const MAX_BUFFER = 64 * 1024 * 1024

/** Runs git once; rejects with git's own stderr so failures are reported verbatim. */
function gitOnce(cwd: string, args: string[], network: boolean): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      // --no-optional-locks: our background status polling must never hold the index lock, or it would
      // make a user's concurrent commit fail with "index.lock exists". Real writes still lock normally.
      ['--no-optional-locks', '-c', 'core.quotepath=off', ...args],
      {
        cwd,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        windowsHide: true,
        // Network commands must fail with a message instead of waiting on a terminal prompt nobody can see.
        env: network ? { ...process.env, GIT_TERMINAL_PROMPT: '0' } : process.env
      },
      (err, stdout, stderr) => {
        if (!err) return resolvePromise(stdout)
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return reject(new Error('git not found on PATH'))
        reject(new Error(`git ${args[0]}: ${stderr.trim() || err.message}`))
      }
    )
  })
}

// Another git process (an editor's auto-fetch, a background maintenance run, antivirus touching the index)
// can hold .git/index.lock for a moment. That is transient, so wait it out; a stale lock still fails below.
const LOCKED = /Unable to create '.*\.lock': File exists/
const LOCK_RETRIES = 4

async function git(cwd: string, args: string[], network = false): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await gitOnce(cwd, args, network)
    } catch (err) {
      if (attempt >= LOCK_RETRIES || !LOCKED.test((err as Error).message)) throw err
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
    }
  }
}

const repos = new Map<string, Repo>() // opened folder -> repo; non-repos aren't cached so `git init` is noticed

/** Resolves the repository for an opened folder. Null means "not a git repository" — a normal state. */
async function repoFor(root: string): Promise<Repo | null> {
  const cached = repos.get(root)
  if (cached) return cached
  try {
    const repo = { top: resolve((await git(root, ['rev-parse', '--show-toplevel'])).trim()) }
    repos.set(root, repo)
    return repo
  } catch (err) {
    if (!/not a git repository/i.test((err as Error).message)) throw err
    return null
  }
}

async function needRepo(root: string): Promise<Repo> {
  const repo = await repoFor(root)
  if (!repo) throw new Error(`${root} is not inside a git repository`)
  return repo
}

const toGitPath = (repo: Repo, abs: string): string => relative(repo.top, abs).split('\\').join('/')

function kindOf(x: string, y: string): ChangeKind {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict'
  if (x === 'A') return 'added'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'R' || y === 'R') return 'renamed'
  return 'modified'
}

async function status(root: string): Promise<GitStatus | null> {
  const repo = await repoFor(root)
  if (!repo) return null
  const out = await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  const fields = out.split('\0')
  let branch = ''
  let oid = ''
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  const changes: GitChange[] = []
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] ?? ''
    if (!f) continue
    if (f.startsWith('# branch.head ')) branch = f.slice('# branch.head '.length)
    else if (f.startsWith('# branch.oid ')) oid = f.slice('# branch.oid '.length)
    else if (f.startsWith('# branch.upstream ')) upstream = f.slice('# branch.upstream '.length)
    else if (f.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(f)
      ahead = Number(m?.[1] ?? 0)
      behind = Number(m?.[2] ?? 0)
    }
    else if (f.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const p = f.split(' ')
      const xy = p[1] ?? '..'
      changes.push({ path: resolve(repo.top, p.slice(8).join(' ')), kind: kindOf(xy[0] ?? '.', xy[1] ?? '.') })
    } else if (f.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const p = f.split(' ')
      changes.push({ path: resolve(repo.top, p.slice(9).join(' ')), kind: 'renamed' })
      i++ // skip the origPath field
    } else if (f.startsWith('u ')) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      changes.push({ path: resolve(repo.top, f.split(' ').slice(10).join(' ')), kind: 'conflict' })
    } else if (f.startsWith('? ')) changes.push({ path: resolve(repo.top, f.slice(2)), kind: 'untracked' })
  }
  const detached = branch === '(detached)'
  return { branch: detached ? oid.slice(0, 7) : branch, detached, upstream, ahead, behind, changes }
}

/** `git blame --porcelain` for a whole file: one entry per final line (index = line - 1). */
function parseBlame(out: string): BlameLine[] {
  const info = new Map<string, BlameLine>()
  const lines: BlameLine[] = []
  let current: BlameLine | null = null
  for (const row of out.split('\n')) {
    if (row.startsWith('\t')) {
      if (current) lines.push(current)
      continue
    }
    const header = /^([0-9a-f]{40}) \d+ \d+/.exec(row)
    if (header) {
      const sha = header[1] as string
      current = info.get(sha) ?? { sha, author: '', time: 0, summary: '' }
      info.set(sha, current)
    } else if (current) {
      if (row.startsWith('author ')) current.author = row.slice(7)
      else if (row.startsWith('author-time ')) current.time = Number(row.slice(12))
      else if (row.startsWith('summary ')) current.summary = row.slice(8)
    }
  }
  return lines
}

export function registerGit(): void {
  ipcMain.handle('git:status', (_e, root: string) => status(root))

  /** File content at HEAD. The renderer only asks for files that exist there. */
  ipcMain.handle('git:show', async (_e, root: string, abs: string) => {
    const repo = await needRepo(root)
    return git(root, ['show', `HEAD:${toGitPath(repo, abs)}`])
  })

  /** Null when the file isn't tracked yet (nothing to blame) — a normal state, not an error. */
  ipcMain.handle('git:blame', async (_e, root: string, abs: string): Promise<BlameLine[] | null> => {
    const repo = await needRepo(root)
    const rel = toGitPath(repo, abs)
    try {
      await git(root, ['ls-files', '--error-unmatch', '--', rel])
    } catch (err) {
      if (!/did not match any file/i.test((err as Error).message)) throw err
      return null
    }
    return parseBlame(await git(root, ['blame', '--porcelain', '--', rel]))
  })

  ipcMain.handle('git:branches', async (_e, root: string): Promise<string[]> => {
    await needRepo(root)
    const out = await git(root, ['branch', '--format=%(refname:short)'])
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  })

  ipcMain.handle('git:switch', async (_e, root: string, branch: string) => {
    await needRepo(root)
    await git(root, ['switch', branch])
  })

  ipcMain.handle('git:createBranch', async (_e, root: string, name: string) => {
    await needRepo(root)
    await git(root, ['switch', '-c', name])
  })

  /** Pushes the current branch; with no upstream yet, publishes it to origin and sets the upstream. */
  ipcMain.handle('git:push', async (_e, root: string) => {
    await needRepo(root)
    const st = await status(root)
    if (!st || st.detached) throw new Error('Cannot push: HEAD is detached')
    if (st.upstream) return void (await git(root, ['push'], true))
    const remotes = (await git(root, ['remote'])).split('\n').map((s) => s.trim()).filter(Boolean)
    if (!remotes.length) throw new Error('Cannot push: this repository has no remote configured')
    if (!remotes.includes('origin')) throw new Error(`Cannot push: no "origin" remote (found: ${remotes.join(', ')})`)
    await git(root, ['push', '--set-upstream', 'origin', st.branch], true)
  })

  /** Fast-forward only: never creates a merge commit behind the user's back. */
  ipcMain.handle('git:pull', async (_e, root: string) => {
    await needRepo(root)
    await git(root, ['pull', '--ff-only'], true)
  })

  ipcMain.handle('git:stashList', async (_e, root: string): Promise<StashEntry[]> => {
    await needRepo(root)
    const out = await git(root, ['stash', 'list', '--format=%gd%x09%gs'])
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref = '', ...rest] = line.split('\t')
        return { ref, message: rest.join('\t') }
      })
  })

  ipcMain.handle('git:stashPush', async (_e, root: string, message: string) => {
    await needRepo(root)
    // -u: untracked files are part of "my changes" too.
    await git(root, ['stash', 'push', '--include-untracked', ...(message.trim() ? ['-m', message.trim()] : [])])
  })

  ipcMain.handle('git:stashPop', async (_e, root: string, ref: string) => {
    await needRepo(root)
    await git(root, ['stash', 'pop', ref])
  })

  ipcMain.handle('git:stashDrop', async (_e, root: string, ref: string) => {
    await needRepo(root)
    await git(root, ['stash', 'drop', ref])
  })

  /** Discards a change. Untracked files are the renderer's job (Recycle Bin); renames/conflicts aren't handled. */
  ipcMain.handle('git:revert', async (_e, root: string, abs: string, kind: ChangeKind) => {
    const repo = await needRepo(root)
    const rel = toGitPath(repo, abs)
    if (kind === 'modified' || kind === 'deleted') {
      await git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', rel])
    } else if (kind === 'added') {
      await git(root, ['restore', '--staged', '--', rel]) // the file stays on disk, now untracked
    } else {
      throw new Error(`Reverting a ${kind} change isn't supported — resolve it with git directly`)
    }
  })

  /** Commits exactly `paths`: stages them, then `commit --only` so other staged work is left out. */
  ipcMain.handle('git:commit', async (_e, root: string, message: string, paths: string[]) => {
    const repo = await needRepo(root)
    if (!message.trim()) throw new Error('Commit message is empty')
    if (!paths.length) throw new Error('No files selected to commit')
    const rels = paths.map((p) => toGitPath(repo, p))
    await git(root, ['add', '--', ...rels])
    await git(root, ['commit', '-m', message, '--only', '--', ...rels])
  })
}
