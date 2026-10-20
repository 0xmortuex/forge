import type { Framework, TestRunResult } from '../main/testrun'
import type { TestCase } from '../main/testparse'
import { totalsOf } from '../main/testparse'

// The Test Explorer: runs the project's tests (node:test, Vitest, Jest or pytest) and shows them as a tree of files, suites
// and tests with their result. Pick a test to read why it failed; double-click it to open it. Run everything, the file you
// are in, or just the tests that failed last time.

export interface TestExplorerDeps {
  /** The window's own root element. */
  root: HTMLElement
  getRoot: () => string | null
  relPath: (path: string) => string
  /** The file in the editor (absolute), or null. */
  activeFile: () => string | null
  /** Opens a file, at a line when it is known. */
  openAt: (path: string, line?: number) => Promise<void>
  readFile: (path: string) => Promise<string>
  /** Brings the window on screen. */
  reveal: () => void
  /** Called with the number of failed tests after every run (for a badge). */
  onFailures: (failed: number) => void
  report: (msg: string, isError?: boolean) => void
}

export interface TestExplorerView {
  runAll: () => Promise<void>
  /** Looks for test frameworks (when the window opens). */
  refresh: () => Promise<void>
}

const ICON = { passed: '✓', failed: '✕', skipped: '○' } as const
const keyOf = (t: TestCase): string => `${t.file.toLowerCase()}|${t.suite.join('›')}|${t.name}`
const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** The line a test starts on: its name in quotes after it/test/describe, found in the file's text. */
export function findTestLine(text: string, name: string): number | undefined {
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b(?:it|test|describe|def|fn)\\b[^\\n]*?(['"\`])${quoted}\\1`)
  const lines = text.split('\n')
  const i = lines.findIndex((l) => re.test(l))
  if (i >= 0) return i + 1
  const plain = lines.findIndex((l) => l.includes(name))
  return plain >= 0 ? plain + 1 : undefined
}

export function initTestExplorer(d: TestExplorerDeps): TestExplorerView {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  const bar = el('div', 'tool-bar tests-bar')
  const framework = el('select', 'field tests-framework')
  framework.setAttribute('aria-label', 'Test framework')
  framework.id = 'tests-framework'
  const runAllBtn = el('button', 'btn-primary', 'Run All')
  runAllBtn.id = 'tests-run'
  const runFileBtn = el('button', 'btn', 'Run File')
  runFileBtn.id = 'tests-file'
  runFileBtn.title = 'Run the tests of the file in the editor'
  const runFailedBtn = el('button', 'btn', 'Run Failed')
  runFailedBtn.id = 'tests-failed'
  const summary = el('span', 'tests-summary')
  summary.id = 'tests-summary'
  bar.append(framework, runAllBtn, runFileBtn, runFailedBtn, summary)

  const body = el('div', 'tests-body')
  const tree = el('div', 'tests-tree')
  tree.id = 'tests-tree'
  const detail = el('div', 'tests-detail')
  detail.id = 'tests-detail'
  body.append(tree, detail)
  d.root.replaceChildren(bar, body)

  let frameworks: Framework[] = []
  let tests: TestCase[] = []
  let ranWith: Framework | null = null
  let durationMs = 0
  let selected: TestCase | null = null
  let running = false
  const closed = new Set<string>() // folders the user collapsed

  function showDetail(t: TestCase | null, note?: string): void {
    detail.replaceChildren()
    if (!t) {
      detail.append(el('div', 'hint', note ?? 'Pick a test to see its result.'))
      return
    }
    detail.append(el('div', `tests-title ${t.status}`, `${ICON[t.status]} ${[...t.suite, t.name].join(' › ')}`))
    detail.append(el('div', 'tests-meta', `${t.status}${t.durationMs ? ` · ${t.durationMs < 1 ? '<1' : Math.round(t.durationMs)} ms` : ''}${t.file ? ` · ${d.relPath(t.file)}${t.line ? `:${t.line}` : ''}` : ''}`))
    if (t.message) detail.append(el('pre', 'tests-message', t.message))
    if (t.file) {
      const go = el('button', 'btn', 'Go to Test')
      go.id = 'tests-goto'
      go.onclick = () => void openTest(t)
      detail.append(go)
    }
  }

  async function openTest(t: TestCase): Promise<void> {
    if (!t.file) return d.report('This runner does not say which file the test is in', true)
    let line = t.line
    if (line === undefined) {
      try {
        line = findTestLine(await d.readFile(t.file), t.name)
      } catch {
        line = undefined // the file may have moved; opening it will say so
      }
    }
    await d.openAt(t.file, line).catch(() => undefined) // reported by the opener
  }

  interface Node {
    name: string
    children: Map<string, Node>
    tests: TestCase[]
  }

  function draw(): void {
    tree.replaceChildren()
    framework.replaceChildren()
    for (const f of frameworks) {
      const o = el('option', '', f)
      o.value = f
      framework.append(o)
    }
    if (ranWith) framework.value = ranWith
    framework.hidden = frameworks.length < 2
    runAllBtn.disabled = running || !frameworks.length
    runFileBtn.disabled = running || !frameworks.length
    runFailedBtn.disabled = running || !tests.some((t) => t.status === 'failed')
    if (!tests.length) {
      tree.append(el('div', 'hint', frameworks.length ? 'Run the tests to see them here.' : d.getRoot() ? 'No tests found. Forge looks for node:test, Vitest, Jest and pytest.' : 'Open a folder first (Ctrl+O).'))
      return
    }
    // files -> suites -> tests
    const roots = new Map<string, Node>()
    for (const t of tests) {
      const file = t.file ? d.relPath(t.file) : '(tests)'
      let node: Node = roots.get(file) ?? { name: file, children: new Map(), tests: [] }
      roots.set(file, roots.get(file) ?? node)
      for (const s of t.suite) {
        const child: Node = node.children.get(s) ?? { name: s, children: new Map(), tests: [] }
        node.children.set(s, child)
        node = child
      }
      node.tests.push(t)
    }
    const all = (n: Node): TestCase[] => [...n.tests, ...[...n.children.values()].flatMap(all)]
    const drawNode = (n: Node, depth: number, path: string): void => {
      const mine = all(n)
      const failed = mine.filter((t) => t.status === 'failed').length
      const key = `${path}/${n.name}`
      const head = el('div', `tests-folder ${failed ? 'failed' : 'ok'}`)
      head.style.paddingLeft = `${8 + depth * 14}px`
      head.dataset['folder'] = n.name
      const open = !closed.has(key)
      head.append(el('span', 'tests-chev', open ? '▾' : '▸'), el('span', 'tests-icon', failed ? ICON.failed : ICON.passed), el('span', 'tests-name', n.name), el('span', 'tests-count', failed ? `${failed} failed` : `${mine.length}`))
      head.onclick = () => {
        if (closed.has(key)) closed.delete(key)
        else closed.add(key)
        draw()
      }
      tree.append(head)
      if (!open) return
      for (const c of n.children.values()) drawNode(c, depth + 1, key)
      for (const t of n.tests) {
        const row = el('div', `tests-test ${t.status}${t === selected ? ' sel' : ''}`)
        row.style.paddingLeft = `${22 + (depth + 1) * 14}px`
        row.dataset['test'] = t.name
        row.append(el('span', 'tests-icon', ICON[t.status]), el('span', 'tests-name', t.name), el('span', 'tests-time', t.durationMs ? `${t.durationMs < 1 ? '<1' : Math.round(t.durationMs)} ms` : ''))
        row.onclick = () => {
          selected = t
          showDetail(t)
          tree.querySelectorAll('.tests-test.sel').forEach((r) => r.classList.remove('sel'))
          row.classList.add('sel')
        }
        row.ondblclick = () => void openTest(t)
        tree.append(row)
      }
    }
    for (const n of [...roots.values()].sort((a, b) => a.name.localeCompare(b.name))) drawNode(n, 0, '')
  }

  function setSummary(): void {
    const t = totalsOf(tests)
    summary.classList.toggle('err', t.failed > 0)
    summary.textContent = tests.length ? `${t.passed} passed${t.failed ? `, ${t.failed} failed` : ''}${t.skipped ? `, ${t.skipped} skipped` : ''} · ${durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`}` : ''
    d.onFailures(t.failed)
  }

  /** Runs the tests, merging a partial run (one file, or some names) into what is already shown. */
  async function run(opts: { file?: string; names?: string[] }): Promise<void> {
    const root = d.getRoot()
    if (!root) throw new Error('Open a folder first (Ctrl+O)')
    const fw = (framework.value || frameworks[0]) as Framework | undefined
    if (!fw) throw new Error('No test framework was found in this project')
    d.reveal()
    running = true
    summary.classList.remove('err')
    summary.textContent = 'Running…'
    draw()
    try {
      const res: TestRunResult = await window.forge.testsRun(root, { framework: fw, ...opts })
      ranWith = fw
      const asked = opts.names ? res.tests.filter((t) => opts.names?.includes(t.name)) : res.tests // a name filter marks every other test skipped: not a result
      if (!opts.file && !opts.names) tests = res.tests
      else {
        const fresh = new Set(asked.map(keyOf))
        const gone = (t: TestCase): boolean => (opts.file ? samePath(t.file, opts.file) : false)
        tests = [...tests.filter((t) => !fresh.has(keyOf(t)) && !gone(t)), ...asked]
      }
      durationMs = res.durationMs
      selected = null
      showDetail(null)
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
      showDetail(null, msg)
      detail.firstElementChild?.classList.add('err')
      summary.textContent = 'The tests could not run'
      summary.classList.add('err')
      throw new Error(msg)
    } finally {
      running = false
      draw()
      if (tests.length) setSummary()
    }
  }

  runAllBtn.onclick = () => void run({}).catch((err: unknown) => d.report(`Tests: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`, true))
  runFileBtn.onclick = () => {
    const file = d.activeFile()
    if (!file) return d.report('Open a test file first', true)
    void run({ file }).catch((err: unknown) => d.report(`Tests: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`, true))
  }
  runFailedBtn.onclick = () => {
    const names = tests.filter((t) => t.status === 'failed').map((t) => t.name)
    if (names.length) void run({ names }).catch((err: unknown) => d.report(`Tests: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`, true))
  }

  showDetail(null)
  draw()
  return {
    runAll: () => run({}),
    async refresh() {
      const root = d.getRoot()
      frameworks = root ? await window.forge.testsDetect(root) : []
      draw()
    }
  }
}
