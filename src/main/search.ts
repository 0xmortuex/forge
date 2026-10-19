import { open, readFile, stat, writeFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { walkFiles } from './walk'

export interface SearchHit {
  path: string
  line: number
  /** 1-based column of the match in the real line, and the same position within `text` (which is trimmed). */
  col: number
  textCol: number
  length: number
  text: string
}

export interface SearchResult {
  hits: SearchHit[]
  truncated: boolean
}

export interface SearchOptions {
  regex?: boolean
  /** Left out: smart case (case-sensitive only if the query has an uppercase letter). */
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Comma-separated globs: "*.ts, src/**". Empty: every file. */
  include?: string
}

const MAX_HITS = 1000
const MAX_FILE_BYTES = 1024 * 1024
const MAX_LINE_CHARS = 300

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Builds the pattern for a query; throws a readable error for an invalid regular expression. */
export function buildPattern(query: string, o: SearchOptions): RegExp {
  if (!query) throw new Error('Empty search query')
  const caseSensitive = o.caseSensitive ?? query !== query.toLowerCase()
  let source = o.regex ? query : escapeRe(query)
  if (o.wholeWord) source = `\\b(?:${source})\\b`
  try {
    return new RegExp(source, caseSensitive ? 'g' : 'gi')
  } catch (err) {
    throw new Error(`Invalid regular expression: ${(err as Error).message}`)
  }
}

/** "*.ts, src/**" -> a test on a path relative to the project (forward slashes). */
function globFilter(include: string | undefined): (rel: string) => boolean {
  const globs = (include ?? '').split(',').map((g) => g.trim()).filter(Boolean)
  if (!globs.length) return () => true
  const tests = globs.map((g) => {
    const hasSlash = g.includes('/')
    const re = new RegExp(
      '^' +
        g
          .split('**')
          .map((part) => part.split('*').map((p) => p.split('?').map(escapeRe).join('[^/]')).join('[^/]*'))
          .join('.*') +
        '$',
      'i'
    )
    return (rel: string): boolean => re.test(hasSlash ? rel : (rel.split('/').pop() ?? rel))
  })
  return (rel) => tests.some((t) => t(rel))
}

async function readText(path: string): Promise<string | null> {
  if ((await stat(path)).size > MAX_FILE_BYTES) return null
  const fh = await open(path, 'r')
  let buf: Buffer
  try {
    buf = await fh.readFile()
  } finally {
    await fh.close()
  }
  if (buf.subarray(0, 8000).includes(0)) return null // binary
  return buf.toString('utf8')
}

export async function searchProject(root: string, query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const pattern = buildPattern(query, options)
  const wanted = globFilter(options.include)
  const hits: SearchHit[] = []
  let truncated = false

  await walkFiles(root, async (path) => {
    if (truncated) return
    if (!wanted(relative(root, path).split('\\').join('/'))) return
    const text = await readText(path)
    if (text === null) return
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(line))) {
        if (m[0] === '') {
          pattern.lastIndex++ // an empty match would loop forever
          continue
        }
        if (hits.length >= MAX_HITS) {
          truncated = true
          return
        }
        // The text shown is trimmed and cut, so the match position is shifted to stay on the same characters.
        const lead = line.length - line.trimStart().length
        hits.push({ path, line: i + 1, col: m.index + 1, textCol: Math.max(1, m.index - lead + 1), length: m[0].length, text: line.trim().slice(0, MAX_LINE_CHARS) })
      }
    }
  })
  return { hits, truncated }
}

/** Replaces every match in the given files (which must be closed in the editor). Returns how many replacements were made. */
export async function replaceInFiles(query: string, options: SearchOptions, replacement: string, paths: string[]): Promise<number> {
  const pattern = buildPattern(query, options)
  // In a plain-text search "$1" is just text; in a regex search it refers to a group.
  const withText = options.regex ? replacement : replacement.replace(/\$/g, '$$$$')
  let total = 0
  for (const path of paths) {
    const text = await readFile(path, 'utf8')
    let count = 0
    const next = text.replace(pattern, (...args) => {
      count++
      // Let the engine expand $1, $& ... exactly as String.replace would.
      return String(args[0]).replace(new RegExp(pattern.source, pattern.flags.replace('g', '')), withText)
    })
    if (count) {
      await writeFile(path, next, 'utf8')
      total += count
    }
  }
  return total
}
