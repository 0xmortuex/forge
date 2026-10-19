// Parsers for what test runners print: TAP (node:test), the JSON of Jest and Vitest, and JUnit XML (pytest). Each gives the same
// flat list of test cases. No file or process access: text in, tests out.

export type TestStatus = 'passed' | 'failed' | 'skipped'

export interface TestCase {
  /** The test's own name. */
  name: string
  /** The suites (describe blocks, classes) around it, outermost first. */
  suite: string[]
  status: TestStatus
  durationMs: number
  /** Why it failed. */
  message?: string
  /** The file it is in (absolute when the runner said so; may be empty when it did not). */
  file: string
  /** The line the test starts on, when the runner said so. */
  line?: number
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// ---------------------------------------------------------------- TAP (node --test --test-reporter=tap)

/** The key: value pairs of a TAP YAML block starting at the '---' line; a "key: |-" block scalar is read as its indented lines. */
function readYaml(lines: string[], dashes: number): Record<string, string> {
  const out: Record<string, string> = {}
  const base = (lines[dashes] as string).length - (lines[dashes] as string).trimStart().length
  for (let j = dashes + 1; j < lines.length; j++) {
    const raw = lines[j] as string
    if (raw.trim() === '...') break
    const indent = raw.length - raw.trimStart().length
    if (indent > base) continue // a continuation line (the keys sit at the same indent as the ---): consumed with its key below
    const m = /^([\w-]+): ?(.*)$/.exec(raw.trim())
    if (!m) continue
    const key = m[1] as string
    let value = (m[2] as string).trim()
    if (/^[|>][+-]?$/.test(value)) {
      const parts: string[] = []
      for (let k = j + 1; k < lines.length; k++) {
        const l = lines[k] as string
        if (l.trim() === '...' || (l.trim() !== '' && l.length - l.trimStart().length <= base)) break
        parts.push(l.trim())
        j = k
      }
      value = parts.join('\n').trim()
    } else if (/^'.*'$/.test(value) || /^".*"$/.test(value)) {
      value = value.slice(1, -1).replace(/\\\\/g, '\\') // TAP writes a backslash as two
    }
    out[key] = value
  }
  return out
}

/** "C:\\a\\b.js:5:3" -> the file and line. */
function locationOf(location: string | undefined): { file: string; line: number } | null {
  const m = location ? /^(.*):(\d+):(\d+)$/.exec(location) : null
  return m ? { file: m[1] as string, line: Number(m[2]) } : null
}

/**
 * node:test's TAP output. A line `ok 1 - name` or `not ok 1 - name` ends a test; the lines before it, indented one level
 * deeper, are its subtests. So a test with subtests is a suite, and only tests without any are reported. `# SKIP` and `# TODO`
 * mark skipped tests, and the YAML block after a failing test holds its error.
 */
export function parseTap(text: string, file = ''): TestCase[] {
  const out: TestCase[] = []
  const lines = text.split(/\r?\n/)
  const indentOf = (l: string): number => l.length - l.trimStart().length
  // Subtests seen per depth since the last test line at that depth (a parent's ok line comes after its children's).
  const children = new Map<number, TestCase[]>()
  const suiteNames = new Map<number, string>()

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string
    const line = raw.trim()
    const depth = indentOf(raw)
    const sub = /^# Subtest: (.*)$/.exec(line)
    if (sub) {
      suiteNames.set(depth, sub[1] as string)
      continue
    }
    const m = /^(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)(?:\b.*)?)?$/.exec(line)
    if (!m) continue
    const failed = m[1] === 'not ok'
    const name = (m[2] as string).replace(/\s+# (SKIP|TODO).*$/, '')
    const skipped = m[3] === 'SKIP' || m[3] === 'TODO'
    // The YAML block that follows: duration, where the test is and, for a failure, why it failed.
    const yaml = (lines[i + 1] ?? '').trim() === '---' ? readYaml(lines, i + 1) : {}
    const duration = Number(yaml['duration_ms'] ?? 0) || 0
    const message = yaml['error'] ?? yaml['code']
    const where = locationOf(yaml['location'])
    const kids = children.get(depth + 4) ?? [] // node indents each level by four spaces
    children.delete(depth + 4)
    if (kids.length) {
      // A suite: its children are tests inside it.
      for (const k of kids) k.suite.unshift(name)
      const parentList = children.get(depth) ?? []
      parentList.push(...kids)
      children.set(depth, parentList)
      continue
    }
    const test: TestCase = {
      name,
      suite: [],
      status: skipped ? 'skipped' : failed ? 'failed' : 'passed',
      durationMs: duration,
      message: failed ? message || 'The test failed' : undefined,
      file: where?.file ?? file,
      line: where?.line
    }
    const list = children.get(depth) ?? []
    list.push(test)
    children.set(depth, list)
  }
  // Whatever is left at depth 0 is the final list, in order.
  out.push(...(children.get(0) ?? []))
  return out
}

// ---------------------------------------------------------------- Jest and Vitest JSON

interface JestAssertion {
  title?: string
  fullName?: string
  ancestorTitles?: string[]
  status?: string
  duration?: number | null
  failureMessages?: string[]
}
interface JestFile {
  name?: string
  assertionResults?: JestAssertion[]
  /** Set when the file itself failed to run (a syntax error, a missing import). */
  message?: string
  status?: string
}

export function parseJestJson(text: string): TestCase[] {
  const data = JSON.parse(text) as { testResults?: JestFile[] }
  const out: TestCase[] = []
  for (const f of data.testResults ?? []) {
    const file = f.name ?? ''
    const results = f.assertionResults ?? []
    if (!results.length && f.status === 'failed') {
      // The file could not be run at all: show that as one failed test, so it is not silently missing.
      out.push({ name: 'The test file failed to run', suite: [], status: 'failed', durationMs: 0, message: (f.message ?? '').trim() || 'The file failed to run', file })
      continue
    }
    for (const a of results) {
      const status = a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped'
      out.push({
        name: a.title ?? a.fullName ?? '(unnamed test)',
        suite: a.ancestorTitles ?? [],
        status,
        durationMs: num(a.duration),
        message: status === 'failed' ? (a.failureMessages ?? []).join('\n').trim() || 'The test failed' : undefined,
        file
      })
    }
  }
  return out
}

// ---------------------------------------------------------------- JUnit XML (pytest --junitxml)

const unescapeXml = (s: string): string =>
  s
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1] as string] = unescapeXml(m[2] as string)
  return out
}

export function parseJunit(xml: string): TestCase[] {
  const out: TestCase[] = []
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const a = attrs(m[1] as string)
    const body = m[3] ?? ''
    const fail = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(body)
    const skipped = /<skipped\b/.test(body)
    const cls = a['classname'] ?? ''
    out.push({
      name: a['name'] ?? '(unnamed test)',
      suite: cls ? cls.split('.') : [],
      status: fail ? 'failed' : skipped ? 'skipped' : 'passed',
      durationMs: Math.round(Number(a['time'] ?? 0) * 1000),
      message: fail ? unescapeXml(((fail[2] ?? fail[5] ?? '').match(/message="([^"]*)"/)?.[1] ?? '') || fail[3] || 'The test failed').trim() : undefined,
      file: a['file'] ?? ''
    })
  }
  return out
}

export interface Totals {
  passed: number
  failed: number
  skipped: number
}

export function totalsOf(tests: TestCase[]): Totals {
  const t: Totals = { passed: 0, failed: 0, skipped: 0 }
  for (const c of tests) t[c.status]++
  return t
}
