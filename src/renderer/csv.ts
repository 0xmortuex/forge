// CSV / TSV parsing and sorting for the table viewer. Pure functions, no DOM.

export type Delimiter = ',' | '\t' | ';' | '|'

const CANDIDATES: Delimiter[] = [',', '\t', ';', '|']

/** Picks the delimiter that splits the first lines into the same, largest number of columns. */
export function detectDelimiter(text: string, fileName = ''): Delimiter {
  if (/\.tsv$/i.test(fileName)) return '\t'
  const sample = text.split(/\r?\n/).filter(Boolean).slice(0, 10)
  let best: Delimiter = ','
  let bestScore = 0
  for (const d of CANDIDATES) {
    const counts = sample.map((line) => (parseDelimited(line, d)[0] ?? []).length)
    const first = counts[0] ?? 0
    if (first < 2) continue
    const consistent = counts.every((n) => n === first)
    const score = first * (consistent ? 10 : 1)
    if (score > bestScore) {
      best = d
      bestScore = score
    }
  }
  return best
}

/** RFC 4180: quoted fields may contain delimiters, newlines and doubled quotes. A trailing empty line is not a row. */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/

/** Sorts rows by a column: numerically when both cells are numbers, otherwise as text. Returns a new array. */
export function sortRows(rows: string[][], column: number, descending: boolean): string[][] {
  const dir = descending ? -1 : 1
  return [...rows].sort((a, b) => {
    const x = a[column] ?? ''
    const y = b[column] ?? ''
    if (NUMBER.test(x) && NUMBER.test(y)) return (Number(x) - Number(y)) * dir
    return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }) * dir
  })
}

/** Rows containing the text in any cell (case-insensitive). */
export function filterRows(rows: string[][], query: string): string[][] {
  const q = query.trim().toLowerCase()
  return q ? rows.filter((r) => r.some((c) => c.toLowerCase().includes(q))) : rows
}
