import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ipcMain } from 'electron'
import { parseJestJson, parseJunit, parseTap, totalsOf, type TestCase, type Totals } from './testparse'
import { findOnPath } from './terminal'

// The Test Explorer's engine: finds out which test framework a project uses, runs it with machine-readable output, and turns
// the result into a list of test cases.

export type Framework = 'vitest' | 'jest' | 'node' | 'pytest'

export interface TestRunResult {
  framework: Framework
  tests: TestCase[]
  totals: Totals
  durationMs: number
  /** What the runner printed (the tail of it), for when something is wrong. */
  output: string
}

export interface RunOptions {
  framework: Framework
  /** Run only this file. */
  file?: string
  /** Run only tests with these names. */
  names?: string[]
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'build', '.venv', 'venv', '__pycache__', 'coverage'])
const TIMEOUT_MS = 10 * 60 * 1000
const MAX_OUTPUT = 4 * 1024 * 1024
const PARALLEL_FILES = 4
const nodeRequire = createRequire(__filename)
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether some file under `dir` (a few levels down) satisfies `match`. */
async function anyFile(dir: string, match: (name: string) => boolean, depth = 3): Promise<boolean> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of entries) {
    if (e.isFile() && match(e.name)) return true
  }
  if (depth <= 0) return false
  for (const e of entries) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && (await anyFile(join(dir, e.name), match, depth - 1))) return true
  }
  return false
}

const NODE_TEST_FILE = /(^|[.\-_])test\.(c|m)?js$/
const TEST_DIRS = new Set(['test', 'tests', '__tests__'])

/** The files node's own test runner would pick up: *.test.js (and -test, _test) anywhere, any .js file inside a test folder. */
export async function nodeTestFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string, depth: number, inTestDir: boolean): Promise<void> => {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && depth < 6) await walk(join(d, e.name), depth + 1, inTestDir || TEST_DIRS.has(e.name))
      } else if (/\.(c|m)?js$/.test(e.name) && (NODE_TEST_FILE.test(e.name) || inTestDir)) out.push(join(d, e.name))
    }
  }
  await walk(dir, 0, false)
  return out
}

/** The test frameworks the project at `dir` seems to use, most likely first. */
export async function detectFrameworks(dir: string): Promise<Framework[]> {
  const found: Framework[] = []
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } = {}
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as typeof pkg
  } catch {
    pkg = {}
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  if ('vitest' in deps) found.push('vitest')
  if ('jest' in deps) found.push('jest')
  if (/node(?:\.exe)?\s+(?:--\S+\s+)*--test\b/.test(pkg.scripts?.['test'] ?? '') || (await nodeTestFiles(dir)).length) found.push('node')
  if ((await anyFile(dir, (n) => /^test_.*\.py$|^.*_test\.py$/.test(n))) || existsSync(join(dir, 'pytest.ini'))) found.push('pytest')
  return found
}

/** The script of an npm package's bin, in a project's node_modules. */
function binScript(dir: string, pkg: string, bin: string): string {
  let pkgJson: string
  try {
    pkgJson = nodeRequire.resolve(`${pkg}/package.json`, { paths: [dir] })
  } catch {
    throw new Error(`${pkg} is not installed in this project: run the install command first`)
  }
  const { bin: b } = JSON.parse(readFileSync(pkgJson, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof b === 'string' ? b : b[bin]
  if (!rel) throw new Error(`${pkg} has no "${bin}" program`)
  return join(dirname(pkgJson), rel)
}

function pythonCommand(): string {
  for (const name of ['python', 'python3', 'py']) {
    try {
      return findOnPath(name)
    } catch {
      // try the next name
    }
  }
  throw new Error('Python was not found on PATH, so pytest cannot run')
}

interface Job {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  /** Where the results are written (JSON or XML), or null when they are on stdout. */
  resultFile: string | null
  parse: (text: string) => TestCase[]
}

/** The commands to run: one for most frameworks, one per file for node:test (its output does not say which file a test is in). */
async function jobs(dir: string, tmp: string, o: RunOptions): Promise<Job[]> {
  const pattern = o.names?.length ? `(${o.names.map(escapeRe).join('|')})` : null
  const electronAsNode = { ELECTRON_RUN_AS_NODE: '1' }
  switch (o.framework) {
    case 'vitest': {
      const out = join(tmp, 'results.json')
      return [{
        command: process.execPath,
        args: [binScript(dir, 'vitest', 'vitest'), 'run', '--reporter=json', `--outputFile=${out}`, ...(o.file ? [o.file] : []), ...(pattern ? ['-t', pattern] : [])],
        env: electronAsNode,
        resultFile: out,
        parse: parseJestJson
      }]
    }
    case 'jest': {
      const out = join(tmp, 'results.json')
      return [{
        command: process.execPath,
        args: [binScript(dir, 'jest', 'jest'), '--json', `--outputFile=${out}`, '--ci', ...(o.file ? [o.file] : []), ...(pattern ? ['-t', pattern] : [])],
        env: electronAsNode,
        resultFile: out,
        parse: parseJestJson
      }]
    }
    case 'node': {
      const files = o.file ? [o.file] : await nodeTestFiles(dir)
      return files.map((file) => ({
        command: process.execPath,
        args: ['--test', '--test-reporter=tap', ...(pattern ? ['--test-name-pattern', pattern] : []), file],
        env: electronAsNode,
        resultFile: null,
        parse: (text: string) => parseTap(text, file)
      }))
    }
    case 'pytest': {
      const out = join(tmp, 'results.xml')
      return [{
        command: pythonCommand(),
        args: ['-m', 'pytest', `--junitxml=${out}`, '-q', ...(o.file ? [o.file] : []), ...(o.names?.length ? ['-k', o.names.join(' or ')] : [])],
        resultFile: out,
        parse: parseJunit
      }]
    }
  }
}

async function runJob(job: Job, dir: string, framework: Framework): Promise<{ tests: TestCase[]; output: string }> {
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((done, fail) => {
    execFile(job.command, job.args, { cwd: dir, env: { ...process.env, ...job.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }, maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS, windowsHide: true, encoding: 'utf8' }, (err, out, errOut) => {
      // A non-zero exit just means some tests failed; only a runner that could not start at all is an error.
      const code = (err as (Error & { code?: unknown }) | null)?.code
      if (err && typeof code !== 'number') return fail(new Error(`${framework} could not run: ${err.message}`))
      done({ stdout: out, stderr: errOut })
    })
  })
  const output = `${stdout}\n${stderr}`.trim()
  const tail = output.split('\n').slice(-25).join('\n')
  let text = stdout
  if (job.resultFile) {
    try {
      text = await readFile(job.resultFile, 'utf8')
    } catch {
      throw new Error(`${framework} produced no results. Its output ends with:\n${tail}`)
    }
  }
  return { tests: job.parse(text), output: tail }
}

export async function runTests(dir: string, o: RunOptions): Promise<TestRunResult> {
  const tmp = await mkdtemp(join(tmpdir(), 'forge-tests-'))
  try {
    const started = Date.now()
    const list = await jobs(dir, tmp, o)
    const tests: TestCase[] = []
    let output = ''
    // A few files at a time: enough to be quick, few enough not to starve the machine.
    for (let i = 0; i < list.length; i += PARALLEL_FILES) {
      const batch = await Promise.all(list.slice(i, i + PARALLEL_FILES).map((job) => runJob(job, dir, o.framework)))
      for (const r of batch) {
        tests.push(...r.tests)
        output = r.output
      }
    }
    if (!tests.length) throw new Error(`${o.framework} ran, but no tests were found.${output ? ` Its output ends with:\n${output}` : ''}`)
    return { framework: o.framework, tests, totals: totalsOf(tests), durationMs: Date.now() - started, output }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

export function registerTestRun(): void {
  ipcMain.handle('tests:detect', (_e, dir: string) => detectFrameworks(dir))
  ipcMain.handle('tests:run', (_e, dir: string, options: RunOptions) => runTests(dir, options))
}
