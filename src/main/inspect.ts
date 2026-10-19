import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { ipcMain } from 'electron'

// "Inspect Code": the language servers only report the files that are open, so this runs the project's own checkers
// over everything: `tsc --noEmit` (TypeScript projects) and ESLint (when the project has it installed).

export interface InspectProblem {
  path: string
  line: number
  col: number
  severity: 'error' | 'warning' | 'info'
  message: string
  /** e.g. "TS2322" or an ESLint rule id. */
  code: string
  source: 'tsc' | 'eslint'
}

export interface InspectResult {
  problems: InspectProblem[]
  /** What ran, for the status line: e.g. ["tsc", "eslint"]. */
  ran: string[]
}

const MAX_BUFFER = 64 * 1024 * 1024

/** Runs a node script and resolves with its output whatever the exit code (checkers exit 1 when they find problems). */
function runNode(script: string, args: string[], cwd: string): Promise<string> {
  return new Promise((done, fail) => {
    execFile(process.execPath, [script, ...args], { cwd, maxBuffer: MAX_BUFFER, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, stdout, stderr) => {
      const code = (err as (Error & { code?: unknown }) | null)?.code
      if (err && typeof code !== 'number') return fail(new Error(`${script}: ${err.message}\n${stderr}`))
      done(stdout)
    })
  })
}

/** `src/a.ts(3,7): error TS2322: message` (non-pretty tsc output); continuation lines are indented. */
export function parseTsc(output: string, root: string): InspectProblem[] {
  const problems: InspectProblem[] = []
  const re = /^(.+?)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/
  for (const line of output.split(/\r?\n/)) {
    const m = re.exec(line)
    if (m) {
      const file = m[1] as string
      problems.push({
        path: isAbsolute(file) ? file : resolve(root, file),
        line: Number(m[2]),
        col: Number(m[3]),
        severity: m[4] === 'error' ? 'error' : m[4] === 'warning' ? 'warning' : 'info',
        code: m[5] as string,
        message: m[6] as string,
        source: 'tsc'
      })
    } else if (/^\s+\S/.test(line) && problems.length) {
      const last = problems[problems.length - 1] as InspectProblem
      last.message += `\n${line.trim()}`
    }
  }
  return problems
}

interface EslintFile {
  filePath: string
  messages: { line?: number; column?: number; severity: number; message: string; ruleId: string | null }[]
}

export function parseEslint(json: string): InspectProblem[] {
  const files = JSON.parse(json) as EslintFile[]
  return files.flatMap((f) =>
    f.messages.map((m) => ({
      path: f.filePath,
      line: m.line ?? 1,
      col: m.column ?? 1,
      severity: m.severity >= 2 ? ('error' as const) : ('warning' as const),
      message: m.message,
      code: m.ruleId ?? '',
      source: 'eslint' as const
    }))
  )
}

export async function inspectProject(root: string): Promise<InspectResult> {
  const problems: InspectProblem[] = []
  const ran: string[] = []

  if (existsSync(join(root, 'tsconfig.json'))) {
    // The project's own TypeScript (matches its settings and version); Forge's copy only when it has none.
    let tsc = join(root, 'node_modules', 'typescript', 'lib', 'tsc.js')
    if (!existsSync(tsc)) tsc = require.resolve('typescript/lib/tsc.js')
    problems.push(...parseTsc(await runNode(tsc, ['--noEmit', '--pretty', 'false', '-p', root], root), root))
    ran.push('tsc')
  }

  const eslint = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js')
  if (existsSync(eslint)) {
    problems.push(...parseEslint(await runNode(eslint, ['.', '--format', 'json'], root)))
    ran.push('eslint')
  }

  if (!ran.length) throw new Error('Nothing to inspect: the project has no tsconfig.json and no ESLint installed (node_modules/eslint)')
  return { problems, ran }
}

export function registerInspect(): void {
  ipcMain.handle('inspect:run', (_e, root: string) => inspectProject(root))
}
