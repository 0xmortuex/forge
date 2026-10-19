import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { ipcMain } from 'electron'
import { findOnPath } from './terminal'

// The npm window's data: the package.json files of the project (a monorepo has several), their scripts, their dependencies with
// the version that is installed, and which of them are out of date.

export type Manager = 'pnpm' | 'npm' | 'yarn' | 'bun'
export type DepKind = 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'

export interface NpmDep {
  name: string
  /** The range in package.json ("^1.2.0"). */
  range: string
  /** The version in node_modules, or null when it is not installed. */
  installed: string | null
  kind: DepKind
}

export interface NpmPackage {
  /** Folder of the package.json (absolute). */
  dir: string
  /** Relative to the project root ("." for the root). */
  rel: string
  name: string
  version: string
  manager: Manager
  scripts: { name: string; command: string }[]
  deps: NpmDep[]
  /** Set when the package.json could not be read; the other fields are then empty. */
  error?: string
}

export interface Outdated {
  current: string | null
  wanted: string
  latest: string
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'build', '.idea', '.vscode', 'coverage'])
const MAX_DEPTH = 3
const MAX_PACKAGES = 60
const KINDS: DepKind[] = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/** The package manager the project uses: the "packageManager" field, else the lockfile, looked for up to the project root. */
export function detectManager(dir: string, root: string, declared?: string): Manager {
  const field = declared?.split('@')[0]
  if (field === 'pnpm' || field === 'yarn' || field === 'bun' || field === 'npm') return field
  let at = dir
  for (;;) {
    if (existsSync(join(at, 'pnpm-lock.yaml'))) return 'pnpm'
    if (existsSync(join(at, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(at, 'bun.lockb')) || existsSync(join(at, 'bun.lock'))) return 'bun'
    if (existsSync(join(at, 'package-lock.json'))) return 'npm'
    if (at === root || dirname(at) === at) return 'npm'
    at = dirname(at)
  }
}

async function readPackage(dir: string, root: string): Promise<NpmPackage> {
  const rel = relative(root, dir).split('\\').join('/') || '.'
  const empty = { dir, rel, name: rel === '.' ? 'package' : rel, version: '', manager: detectManager(dir, root), scripts: [], deps: [] }
  let json: Record<string, unknown>
  try {
    json = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch (err) {
    return { ...empty, error: `package.json cannot be read: ${(err as Error).message}` }
  }
  const scripts = Object.entries((json['scripts'] as Record<string, unknown> | undefined) ?? {})
    .filter((e): e is [string, string] => typeof e[1] === 'string')
    .map(([name, command]) => ({ name, command }))
  const deps: NpmDep[] = []
  for (const kind of KINDS) {
    for (const [name, range] of Object.entries((json[kind] as Record<string, unknown> | undefined) ?? {})) {
      let installed: string | null = null
      try {
        installed = (JSON.parse(await readFile(join(dir, 'node_modules', name, 'package.json'), 'utf8')) as { version?: string }).version ?? null
      } catch {
        installed = null // not installed (yet)
      }
      deps.push({ name, range: String(range), installed, kind })
    }
  }
  return {
    ...empty,
    name: typeof json['name'] === 'string' ? json['name'] : empty.name,
    version: typeof json['version'] === 'string' ? json['version'] : '',
    manager: detectManager(dir, root, typeof json['packageManager'] === 'string' ? json['packageManager'] : undefined),
    scripts,
    deps
  }
}

export async function findPackages(root: string): Promise<NpmPackage[]> {
  const dirs: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (dirs.length >= MAX_PACKAGES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name === 'package.json')) dirs.push(dir)
    if (depth >= MAX_DEPTH) return
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(join(dir, e.name), depth + 1)
    }
  }
  await walk(root, 0)
  return Promise.all(dirs.map((d) => readPackage(d, root)))
}

/** Runs npm (a .cmd shim on Windows) and resolves with its output whatever the exit code: `npm outdated` exits 1 when something is outdated. */
function runNpm(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const found = findOnPath('npm')
  const [command, argv] = process.platform === 'win32' && /\.(cmd|bat)$/i.test(found) ? [process.env['ComSpec'] ?? 'cmd.exe', ['/c', found, ...args]] : [found, args]
  return new Promise((done, fail) => {
    execFile(command, argv, { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 120000, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = (err as (Error & { code?: unknown }) | null)?.code
      if (err && typeof code !== 'number') return fail(new Error(`npm: ${err.message}`))
      done({ stdout, stderr, code: typeof code === 'number' ? code : 0 })
    })
  })
}

export async function checkOutdated(dir: string): Promise<Record<string, Outdated>> {
  const { stdout, stderr, code } = await runNpm(dir, ['outdated', '--json'])
  if (!stdout.trim()) {
    if (code && code > 1) throw new Error(`npm outdated failed: ${stderr.trim().split('\n').slice(-3).join(' ')}`)
    return {} // nothing is outdated
  }
  const parsed = JSON.parse(stdout) as Record<string, { current?: string; wanted?: string; latest?: string } | undefined>
  const out: Record<string, Outdated> = {}
  for (const [name, v] of Object.entries(parsed)) {
    if (v?.latest) out[name] = { current: v.current ?? null, wanted: v.wanted ?? v.latest, latest: v.latest }
  }
  return out
}

export function registerNpm(): void {
  ipcMain.handle('npm:packages', (_e, root: string) => findPackages(resolve(root)))
  ipcMain.handle('npm:outdated', (_e, dir: string) => checkOutdated(dir))
}
