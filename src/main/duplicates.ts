import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { ipcMain } from 'electron'
import { walkFiles } from './walk'

// "Find Duplicated Code": copy-pasted blocks across the project. Lines are normalized (trimmed, whitespace collapsed, lines
// that carry no code dropped), every run of `minLines` normalized lines is fingerprinted, and runs that occur more than once
// are checked for real, grown to the longest block all their copies share, and reported once.

export interface DupOccurrence {
  path: string
  startLine: number
  endLine: number
}
export interface DupGroup {
  /** Number of code lines in the block (blank and brace-only lines are not counted). */
  lines: number
  occurrences: DupOccurrence[]
  /** The first lines of the block as written in the first occurrence. */
  sample: string
}
export interface DupResult {
  groups: DupGroup[]
  filesScanned: number
  /** True when there were more groups than are returned. */
  truncated: boolean
}

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.c', '.h', '.cpp', '.cc', '.hpp', '.cs', '.java', '.kt', '.go', '.rs', '.rb', '.php',
  '.swift', '.scala', '.lua', '.dart', '.vue', '.svelte', '.css', '.scss', '.less', '.html', '.htm', '.sql', '.sh', '.ps1', '.mx', '.json', '.yml', '.yaml'
])
const SKIP_NAMES = /(^|[\\/])(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.min\.(js|css)$/i
const MAX_FILE_BYTES = 512 * 1024
const MAX_LINE_CHARS = 400 // a longer line is generated or minified code
const MAX_GROUPS = 300
const SAMPLE_LINES = 12

/** A line that says nothing on its own: closing brackets, lone punctuation, comment-only lines. */
const NOISE = /^([)}\]{[;,.:]+|\/\/.*|\/\*.*|\* .*|\*\/?|#\s.*|#)$/

export interface NormalizedFile {
  /** Normalized code lines. */
  lines: string[]
  /** The 1-based line number in the file of each normalized line. */
  numbers: number[]
}

export function normalize(text: string): NormalizedFile {
  const lines: string[] = []
  const numbers: number[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim().replace(/\s+/g, ' ')
    if (!line || NOISE.test(line)) return
    lines.push(line)
    numbers.push(i + 1)
  })
  return { lines, numbers }
}

const hashLine = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Finds the duplicated blocks among already normalized files. */
export function findDuplicateGroups(files: { path: string; norm: NormalizedFile }[], minLines: number): { groups: DupGroup[]; truncated: boolean } {
  const lineHashes = files.map((f) => f.norm.lines.map(hashLine))
  // Fingerprint of every window of minLines lines.
  const windows = new Map<number, [number, number][]>() // fingerprint -> [file index, start]
  files.forEach((_f, fi) => {
    const hs = lineHashes[fi] as number[]
    for (let p = 0; p + minLines <= hs.length; p++) {
      let h = 0
      for (let k = 0; k < minLines; k++) h = (Math.imul(h, 31) + (hs[p + k] as number)) >>> 0
      const list = windows.get(h)
      if (list) list.push([fi, p])
      else windows.set(h, [[fi, p]])
    }
  })

  const covered = files.map((f) => new Uint8Array(f.norm.lines.length)) // lines already part of a reported block
  const groups: DupGroup[] = []
  const sameText = (a: [number, number], b: [number, number], len: number): boolean => {
    const x = (files[a[0]] as (typeof files)[number]).norm.lines
    const y = (files[b[0]] as (typeof files)[number]).norm.lines
    for (let k = 0; k < len; k++) if (x[a[1] + k] !== y[b[1] + k]) return false
    return true
  }

  // Scan in file order, left to right, so the first window of a block is met before its later windows.
  files.forEach((_f, fi) => {
    const hs = lineHashes[fi] as number[]
    for (let p = 0; p + minLines <= hs.length; p++) {
      if ((covered[fi] as Uint8Array)[p]) continue
      let h = 0
      for (let k = 0; k < minLines; k++) h = (Math.imul(h, 31) + (hs[p + k] as number)) >>> 0
      const all = windows.get(h)
      if (!all || all.length < 2) continue
      // Real copies of this window (a fingerprint can collide), not overlapping an earlier block, not overlapping each other.
      const mine: [number, number] = [fi, p]
      const copies: [number, number][] = [mine]
      for (const o of all) {
        if (o[0] === fi && o[1] === p) continue
        if ((covered[o[0]] as Uint8Array)[o[1]]) continue
        if (!sameText(mine, o, minLines)) continue
        if (copies.some((c) => c[0] === o[0] && Math.abs(c[1] - o[1]) < minLines)) continue
        copies.push(o)
      }
      if (copies.length < 2) continue
      // Grow the block while every copy agrees on the next line.
      let len = minLines
      const first = (files[fi] as (typeof files)[number]).norm.lines
      for (;;) {
        const next = first[p + len]
        if (next === undefined) break
        if (!copies.every((c) => (files[c[0]] as (typeof files)[number]).norm.lines[c[1] + len] === next)) break
        // Copies in the same file must not grow into each other.
        if (copies.some((a, i) => copies.some((b, j) => i !== j && a[0] === b[0] && b[1] > a[1] && a[1] + len + 1 > b[1]))) break
        len++
      }
      for (const c of copies) (covered[c[0]] as Uint8Array).fill(1, c[1], c[1] + len)
      const sampleFile = files[fi] as (typeof files)[number]
      groups.push({
        lines: len,
        occurrences: copies.map(([f, s]) => {
          const n = (files[f] as (typeof files)[number]).norm.numbers
          return { path: (files[f] as (typeof files)[number]).path, startLine: n[s] as number, endLine: n[s + len - 1] as number }
        }),
        sample: sampleFile.norm.lines.slice(p, p + Math.min(len, SAMPLE_LINES)).join('\n')
      })
    }
  })

  groups.sort((a, b) => b.lines * b.occurrences.length - a.lines * a.occurrences.length)
  return { groups: groups.slice(0, MAX_GROUPS), truncated: groups.length > MAX_GROUPS }
}

export async function findDuplicates(root: string, minLines = 6): Promise<DupResult> {
  const min = Math.min(50, Math.max(3, Math.floor(minLines)))
  const files: { path: string; norm: NormalizedFile }[] = []
  await walkFiles(root, async (path) => {
    if (!TEXT_EXT.has(extname(path).toLowerCase()) || SKIP_NAMES.test(path)) return
    if ((await stat(path)).size > MAX_FILE_BYTES) return
    const text = await readFile(path, 'utf8')
    const norm = normalize(text)
    // Generated or minified: very long lines and no real structure.
    if (text.length / Math.max(1, text.split('\n').length) > MAX_LINE_CHARS) return
    if (norm.lines.length >= min) files.push({ path, norm })
  })
  const { groups, truncated } = findDuplicateGroups(files, min)
  return { groups, filesScanned: files.length, truncated }
}

export function registerDuplicates(): void {
  ipcMain.handle('duplicates:find', (_e, root: string, minLines?: number) => findDuplicates(root, minLines))
}
