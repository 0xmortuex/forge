export interface FindDeps {
  input: HTMLInputElement
  results: HTMLElement
  count: HTMLElement
  getRoot: () => string | null
  relPath: (p: string) => string
  openAt: (path: string, line: number) => Promise<void>
  guard: (label: string, fn: () => Promise<void>) => Promise<void>
}

/** Wires up the Find-in-project view. Search runs on Enter. */
export function initFind(d: FindDeps): { show: (title: string, query: string, hits: { path: string; line: number; text: string }[]) => void } {
  let runId = 0 // drops results from a search that was superseded while running

  const render = (query: string, hits: { path: string; line: number; text: string }[]): void => {
    d.results.replaceChildren()
    const caseSensitive = query !== query.toLowerCase()
    const needle = caseSensitive ? query : query.toLowerCase()
    for (const h of hits) {
      const row = document.createElement('div')
      row.className = 'hit'
      const where = document.createElement('span')
      where.className = 'where'
      where.textContent = `${d.relPath(h.path)}:${h.line}`
      const line = document.createElement('span')
      line.className = 'line'
      const at = (caseSensitive ? h.text : h.text.toLowerCase()).indexOf(needle)
      if (at < 0) line.textContent = h.text // match was in trimmed-off whitespace/over the length cap
      else {
        const mark = document.createElement('mark')
        mark.textContent = h.text.slice(at, at + needle.length)
        line.append(h.text.slice(0, at), mark, h.text.slice(at + needle.length))
      }
      row.append(where, line)
      row.onclick = () => void d.openAt(h.path, h.line)
      d.results.append(row)
    }
  }

  d.input.onkeydown = (e) => {
    if (e.key !== 'Enter') return
    const query = d.input.value
    const root = d.getRoot()
    if (!query) return
    if (!root) {
      d.count.textContent = 'Open a folder first (Ctrl+O)'
      return
    }
    const id = ++runId
    d.count.textContent = 'Searching…'
    void d.guard('Find in project', async () => {
      const { hits, truncated } = await window.forge.search(root, query)
      if (id !== runId) return
      render(query, hits)
      d.count.textContent = `${hits.length}${truncated ? '+' : ''} match${hits.length === 1 ? '' : 'es'}`
    })
  }

  return {
    /** Shows results that came from somewhere else (e.g. Find Usages), highlighting `query` on each line. */
    show(title, query, hits) {
      runId++ // an in-flight text search must not overwrite these
      render(query, hits)
      d.count.textContent = title
    }
  }
}
