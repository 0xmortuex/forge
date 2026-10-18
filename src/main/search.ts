import { open, stat } from 'node:fs/promises'
import { walkFiles } from './walk'

export interface SearchHit {
  path: string
  line: number
  text: string
}

export interface SearchResult {
  hits: SearchHit[]
  truncated: boolean
}

const MAX_HITS = 500
const MAX_FILE_BYTES = 1024 * 1024
const MAX_LINE_CHARS = 300

/** Plain-text search. Smart-case: case-sensitive only if the query contains an uppercase letter. */
export async function searchProject(root: string, query: string): Promise<SearchResult> {
  if (!query) throw new Error('Empty search query')
  const caseSensitive = query !== query.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const hits: SearchHit[] = []
  let truncated = false

  await walkFiles(root, async (path) => {
    if (truncated) return
    if ((await stat(path)).size > MAX_FILE_BYTES) return
    const fh = await open(path, 'r')
    let buf: Buffer
    try {
      buf = await fh.readFile()
    } finally {
      await fh.close()
    }
    if (buf.subarray(0, 8000).includes(0)) return // binary
    const lines = buf.toString('utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if ((caseSensitive ? line : line.toLowerCase()).includes(needle)) {
        if (hits.length >= MAX_HITS) {
          truncated = true
          return
        }
        hits.push({ path, line: i + 1, text: line.trim().slice(0, MAX_LINE_CHARS) })
      }
    }
  })
  return { hits, truncated }
}
