import { createHash } from 'node:crypto'

// Partial commits: a file's changes are parsed into hunks and lines, the user picks lines, and a patch containing only the
// picked changes is built. The patch is applied to a temporary index (see git.ts), so the working file is never touched.

export interface DiffLine {
  /** ' ' context, '+' added, '-' removed. */
  kind: ' ' | '+' | '-'
  text: string
  /** The line has no newline at the end of the file ("\ No newline at end of file"). */
  noEol?: boolean
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** The text after the second @@ (git shows the enclosing function there). */
  context: string
  lines: DiffLine[]
}

export interface FileDiff {
  /** "diff --git", "index", "---" and "+++" lines. */
  header: string[]
  hunks: Hunk[]
  /** Identifies this exact diff, so a selection made earlier is never applied to a changed file. */
  fingerprint: string
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

/** Parses `git diff` output for one file. Returns null when there is nothing to choose from (no hunks, e.g. a binary file). */
export function parseDiff(text: string): FileDiff | null {
  const rows = text.split('\n')
  if (rows[rows.length - 1] === '') rows.pop()
  const header: string[] = []
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  for (const row of rows) {
    const m = HUNK.exec(row)
    if (m) {
      current = {
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        context: m[5] ?? '',
        lines: []
      }
      hunks.push(current)
    } else if (!current) {
      header.push(row)
    } else if (row.startsWith('\\')) {
      const last = current.lines[current.lines.length - 1]
      if (last) last.noEol = true
    } else {
      const kind = row[0]
      if (kind !== ' ' && kind !== '+' && kind !== '-') throw new Error(`Unexpected line in the diff: ${row.slice(0, 60)}`)
      current.lines.push({ kind, text: row.slice(1) })
    }
  }
  if (!hunks.length) return null
  return { header, hunks, fingerprint: createHash('sha1').update(text).digest('hex') }
}

/** The indices of a hunk's added and removed lines. */
export const changedIndices = (h: Hunk): number[] => h.lines.flatMap((l, i) => (l.kind === ' ' ? [] : [i]))

/**
 * A patch holding only the chosen changes. `selected[h]` lists the indices (into hunk h's lines) of the added and removed
 * lines to include. A removed line that is not chosen stays as it is (context); an added line that is not chosen is left out.
 * Returns '' when nothing is chosen.
 */
export function buildPatch(diff: FileDiff, selected: number[][]): string {
  const out: string[] = []
  let delta = 0 // lines added minus removed by the hunks included so far: where later hunks start in the new file
  diff.hunks.forEach((hunk, h) => {
    const picked = new Set(selected[h] ?? [])
    const changed = changedIndices(hunk)
    const count = changed.filter((i) => picked.has(i)).length
    if (!count) return
    if (count < changed.length && hunk.lines.some((l) => l.noEol)) {
      throw new Error('A hunk at the end of a file without a trailing newline can only be included or left out as a whole')
    }
    const lines: string[] = []
    let oldLines = 0
    let newLines = 0
    hunk.lines.forEach((l, i) => {
      const suffix = l.noEol ? '\n\\ No newline at end of file' : ''
      if (l.kind === ' ') {
        lines.push(` ${l.text}${suffix}`)
        oldLines++
        newLines++
      } else if (l.kind === '+') {
        if (!picked.has(i)) return
        lines.push(`+${l.text}${suffix}`)
        newLines++
      } else if (picked.has(i)) {
        lines.push(`-${l.text}${suffix}`)
        oldLines++
      } else {
        lines.push(` ${l.text}${suffix}`)
        oldLines++
        newLines++
      }
    })
    out.push(`@@ -${hunk.oldStart},${oldLines} +${hunk.oldStart + delta},${newLines} @@${hunk.context}`, ...lines)
    delta += newLines - oldLines
  })
  return out.length ? [...diff.header, ...out].join('\n') + '\n' : ''
}
