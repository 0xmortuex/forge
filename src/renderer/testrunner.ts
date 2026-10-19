import * as monaco from 'monaco-editor'

// Test run arrows: a green arrow in the gutter beside each test (and each group of tests) in a JavaScript/TypeScript
// or Python file. Click it to run just that test (or group) in the Run window. The runner is chosen from the project:
// Vitest or Jest if package.json lists them, Node's built-in test runner otherwise; pytest for Python.

export interface TestItem {
  line: number
  /** The test's or group's name as written. */
  name: string
  kind: 'test' | 'suite'
}

const JS_TEST = /^\s*(describe|it|test)(?:\.only|\.skip|\.todo)?\s*\(\s*(['"`])(.*?)\2/
const PY_TEST = /^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(|^class\s+(Test\w*)/

/** The tests and groups in a file's text. */
export function findTests(text: string, language: 'js' | 'py'): TestItem[] {
  const out: TestItem[] = []
  text.split(/\r?\n/).forEach((l, i) => {
    if (language === 'js') {
      const m = JS_TEST.exec(l)
      if (m) out.push({ line: i + 1, name: m[3]!, kind: m[1] === 'describe' ? 'suite' : 'test' })
    } else {
      const m = PY_TEST.exec(l)
      if (m) out.push({ line: i + 1, name: m[2] ?? m[3]!, kind: m[3] ? 'suite' : 'test' })
    }
  })
  return out
}

const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type JsRunner = 'vitest' | 'jest' | 'node'

/** The command line that runs one test (or group), or a whole file when `name` is omitted. */
export function testCommand(kind: JsRunner | 'pytest', file: string, rel: string, name?: string): string {
  const q = (s: string): string => (navigator.platform.startsWith('Win') ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, `'\\''`)}'`)
  if (kind === 'pytest') return `python -m pytest ${q(file)}${name ? ` -k ${q(name)}` : ''}`
  if (kind === 'vitest') return `npx vitest run ${q(rel)}${name ? ` -t ${q(reEscape(name))}` : ''}`
  if (kind === 'jest') return `npx jest ${q(rel)}${name ? ` -t ${q(reEscape(name))}` : ''}`
  return `node --test${name ? ` --test-name-pattern ${q(reEscape(name))}` : ''} ${q(file)}`
}

export interface TestRunnerDeps {
  editor: monaco.editor.IStandaloneCodeEditor
  /** The file in the editor, or null. */
  currentPath: () => string | null
  getRoot: () => string | null
  relPath: (p: string) => string
  readFile: (p: string) => Promise<string>
  /** Runs a shell command line in the Run window. */
  runCommand: (label: string, cwd: string, commandLine: string) => Promise<void>
  report: (msg: string, isError?: boolean) => void
}

export interface TestRunner {
  runFile: () => Promise<void>
}

export function initTestRunner(d: TestRunnerDeps): TestRunner {
  const marks = d.editor.createDecorationsCollection()
  let items: TestItem[] = []
  let runner: JsRunner | 'pytest' = 'node'
  let seq = 0

  const languageOf = (path: string): 'js' | 'py' | null =>
    /\.(test|spec)\.[cm]?[jt]sx?$|[\\/]__tests__[\\/]/.test(path) ? 'js' : /(^|[\\/])(test_\w+|\w+_test)\.py$/.test(path) ? 'py' : null

  async function pickRunner(language: 'js' | 'py'): Promise<JsRunner | 'pytest'> {
    if (language === 'py') return 'pytest'
    const root = d.getRoot()
    if (!root) return 'node'
    try {
      const pkg = JSON.parse(await d.readFile(`${root}${root.includes('\\') ? '\\' : '/'}package.json`)) as Record<string, Record<string, string> | undefined>
      const deps = { ...pkg['dependencies'], ...pkg['devDependencies'] }
      if ('vitest' in deps) return 'vitest'
      if ('jest' in deps) return 'jest'
    } catch {
      /* no readable package.json: Node's own runner */
    }
    return 'node'
  }

  async function scan(): Promise<void> {
    const mine = ++seq
    const path = d.currentPath()
    const model = d.editor.getModel()
    const language = path ? languageOf(path) : null
    if (!path || !model || !language) {
      items = []
      marks.clear()
      return
    }
    const r = await pickRunner(language)
    if (mine !== seq) return
    runner = r
    items = findTests(model.getValue(), language)
    marks.set(
      items.map((t) => ({
        range: new monaco.Range(t.line, 1, t.line, 1),
        options: { glyphMarginClassName: 'test-run-glyph', glyphMarginHoverMessage: { value: `Run ${t.kind === 'suite' ? 'tests in' : 'test'} "${t.name}"` } }
      }))
    )
  }
  const run = (): void => void scan().catch((err: unknown) => d.report(`Tests: ${String(err)}`, true))
  let timer: number | undefined
  d.editor.onDidChangeModel(run)
  d.editor.onDidChangeModelContent(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(run, 300)
  })

  async function exec(name?: string): Promise<void> {
    const path = d.currentPath()
    const root = d.getRoot()
    if (!path || !root) return
    await d.runCommand(name ? `Test ${name}` : `Tests in ${d.relPath(path)}`, root, testCommand(runner, path, d.relPath(path), name))
  }

  d.editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return
    const t = items.find((x) => x.line === e.target.position!.lineNumber)
    if (t) void exec(t.name).catch((err: unknown) => d.report(`Run test: ${String(err)}`, true))
  })

  return { runFile: () => exec() }
}
