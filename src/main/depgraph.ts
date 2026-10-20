import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { specifiers } from './safedelete'

// The import graph of a project: which file imports which, and which files import each other in a circle. Built from the
// same relative-reference matching as Safe Delete (JS / TS imports, CSS imports, C includes, Python relative imports...), so
// it sees what is written in the source, not what a bundler or a language server would resolve.

import type { Graph } from './depfold'

export { foldByFolder, type Graph } from './depfold'

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.json', '.css', '.scss', '.sass', '.less', '.py', '.h', '.hpp', '.c', '.cpp', '.cc', '.md', '.html']

const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
const slash = (p: string): string => p.split(sep).join('/')

/** The project file a written reference points at, or null (a package, a URL, a file that is not there). */
export function resolveReference(spec: string, fromFile: string, known: Map<string, string>): string | null {
  const clean = decodeURI(spec.split(/[?#]/)[0] ?? '')
  if (!clean) return null
  const base = resolve(dirname(fromFile), clean)
  const candidates = [base]
  if (!extname(base) || !EXTENSIONS.includes(extname(base).toLowerCase())) for (const e of EXTENSIONS) candidates.push(base + e)
  // TypeScript writes ".js" for the ".ts" file next to it.
  const js = /\.(m|c)?js$/.exec(base)
  if (js) {
    const stem = base.slice(0, -js[0].length)
    candidates.push(`${stem}.${js[1] ?? ''}ts`, `${stem}.tsx`)
  }
  for (const e of EXTENSIONS) candidates.push(join(base, 'index' + e))
  candidates.push(join(base, '__init__.py'))
  for (const c of candidates) {
    const hit = known.get(norm(c))
    if (hit) return hit
  }
  return null
}

/** Builds the graph from the files' contents. `files` are absolute paths with their text. */
export function buildGraph(root: string, files: { path: string; text: string }[]): Graph {
  const known = new Map<string, string>()
  for (const f of files) known.set(norm(resolve(f.path)), resolve(f.path))
  const paths = files.map((f) => resolve(f.path)).sort()
  const index = new Map(paths.map((p, i) => [p, i]))
  const edges = new Map<string, { from: number; to: number }>()
  for (const f of files) {
    const from = index.get(resolve(f.path))
    if (from === undefined) continue
    for (const line of f.text.split(/\r?\n/)) {
      if (line.length > 2000) continue
      for (const spec of specifiers(line)) {
        const target = resolveReference(spec, f.path, known)
        const to = target ? index.get(target) : undefined
        if (to !== undefined && to !== from) edges.set(`${from}>${to}`, { from, to })
      }
    }
  }
  return { files: paths.map((p) => slash(relative(root, p))), edges: [...edges.values()] }
}

/** Groups of files that import each other in a circle (strongly connected components of two or more files). */
export function findCycles(graph: Graph): number[][] {
  const n = graph.files.length
  const out: number[][] = Array.from({ length: n }, () => [])
  for (const e of graph.edges) out[e.from]?.push(e.to)
  const index: number[] = new Array(n).fill(-1)
  const low: number[] = new Array(n).fill(0)
  const onStack: boolean[] = new Array(n).fill(false)
  const stack: number[] = []
  const found: number[][] = []
  let counter = 0
  // Tarjan's algorithm, with an explicit stack so a long import chain cannot overflow the call stack.
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue
    const work: { v: number; next: number }[] = [{ v: root, next: 0 }]
    index[root] = low[root] = counter++
    stack.push(root)
    onStack[root] = true
    while (work.length) {
      const frame = work[work.length - 1] as { v: number; next: number }
      const targets = out[frame.v] ?? []
      if (frame.next < targets.length) {
        const w = targets[frame.next++] as number
        if (index[w] === -1) {
          index[w] = low[w] = counter++
          stack.push(w)
          onStack[w] = true
          work.push({ v: w, next: 0 })
        } else if (onStack[w]) low[frame.v] = Math.min(low[frame.v] as number, index[w] as number)
      } else {
        work.pop()
        const parent = work[work.length - 1]
        if (parent) low[parent.v] = Math.min(low[parent.v] as number, low[frame.v] as number)
        if (low[frame.v] === index[frame.v]) {
          const group: number[] = []
          let w: number
          do {
            w = stack.pop() as number
            onStack[w] = false
            group.push(w)
          } while (w !== frame.v)
          if (group.length > 1) found.push(group.sort((a, b) => a - b))
        }
      }
    }
  }
  return found.sort((a, b) => b.length - a.length || (a[0] as number) - (b[0] as number))
}
