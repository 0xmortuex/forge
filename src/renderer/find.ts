import type { SearchOptions } from '../main/search'

// Find in Files: search the whole project (match case, whole word, regular expression, file mask), see every match with
// its line, and Replace All. Files that are open in the editor are edited there (so Ctrl+Z works and nothing is written
// behind your back); the others are rewritten on disk.

export interface FindHit {
  path: string
  line: number
  text: string
  /** Present for text searches: where the match is in the real line and in `text`, and how long it is. */
  col?: number
  textCol?: number
  length?: number
}

export interface FindDeps {
  input: HTMLInputElement
  results: HTMLElement
  count: HTMLElement
  caseBtn: HTMLElement
  wordBtn: HTMLElement
  regexBtn: HTMLElement
  mask: HTMLInputElement
  replaceInput: HTMLInputElement
  replaceBtn: HTMLElement
  getRoot: () => string | null
  relPath: (p: string) => string
  openAt: (path: string, line: number, column?: number) => Promise<void>
  guard: (label: string, fn: () => Promise<void>) => Promise<void>
  /** The editor's text for a file that is open (replacing happens there), or undefined if it is not open. */
  openText: (path: string) => string | undefined
  /** Replaces the whole text of an open file as one undoable edit. */
  setOpenText: (path: string, text: string) => void
  report: (msg: string, isError?: boolean) => void
}

export interface Finder {
  show: (title: string, query: string, hits: FindHit[]) => void
  /** Runs a search with the current options (also used by TODO). */
  search: () => Promise<void>
  /** Sets the query and runs it. */
  searchFor: (query: string, opts?: { regex?: boolean }) => Promise<void>
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The same pattern the main process builds, for replacing inside open files. */
function pattern(query: string, o: SearchOptions): RegExp {
  const caseSensitive = o.caseSensitive ?? query !== query.toLowerCase()
  let source = o.regex ? query : escapeRe(query)
  if (o.wholeWord) source = `\\b(?:${source})\\b`
  return new RegExp(source, caseSensitive ? 'g' : 'gi')
}

export function initFind(d: FindDeps): Finder {
  let runId = 0 // drops results from a search that was superseded while running
  let hits: FindHit[] = []
  let lastQuery = ''
  let lastOptions: SearchOptions = {}
  let fromSearch = false // the list came from a text search (so Replace All applies), not from Find Usages

  const toggles: [HTMLElement, 'caseSensitive' | 'wholeWord' | 'regex'][] = [
    [d.caseBtn, 'caseSensitive'],
    [d.wordBtn, 'wholeWord'],
    [d.regexBtn, 'regex']
  ]
  const options = (): SearchOptions => {
    const o: SearchOptions = { include: d.mask.value.trim() || undefined }
    if (d.caseBtn.classList.contains('on')) o.caseSensitive = true
    if (d.wordBtn.classList.contains('on')) o.wholeWord = true
    if (d.regexBtn.classList.contains('on')) o.regex = true
    return o
  }

  const render = (query: string, list: FindHit[]): void => {
    d.results.replaceChildren()
    const caseSensitive = query !== query.toLowerCase()
    const needle = caseSensitive ? query : query.toLowerCase()
    for (const h of list) {
      const row = document.createElement('div')
      row.className = 'hit'
      const where = document.createElement('span')
      where.className = 'where'
      where.textContent = `${d.relPath(h.path)}:${h.line}`
      const line = document.createElement('span')
      line.className = 'line'
      // Where the match is: from the search itself when known, else by looking for the query in the line.
      let at = h.textCol !== undefined ? h.textCol - 1 : (caseSensitive ? h.text : h.text.toLowerCase()).indexOf(needle)
      const len = h.length ?? needle.length
      if (at < 0 || at + len > h.text.length) at = -1 // the match was in trimmed-off text
      if (at < 0) line.textContent = h.text
      else {
        const mark = document.createElement('mark')
        mark.textContent = h.text.slice(at, at + len)
        line.append(h.text.slice(0, at), mark, h.text.slice(at + len))
      }
      row.append(where, line)
      row.onclick = () => void d.openAt(h.path, h.line, h.col).catch(() => undefined) // reported by the opener
      d.results.append(row)
    }
  }

  async function search(): Promise<void> {
    const query = d.input.value
    const root = d.getRoot()
    if (!query) return
    if (!root) {
      d.count.textContent = 'Open a folder first (Ctrl+O)'
      return
    }
    const id = ++runId
    d.count.textContent = 'Searching…'
    await d.guard('Find in project', async () => {
      const opts = options()
      const res = await window.forge.search(root, query, opts)
      if (id !== runId) return
      hits = res.hits
      lastQuery = query
      lastOptions = opts
      fromSearch = true
      render(query, hits)
      const files = new Set(hits.map((h) => h.path)).size
      d.count.textContent = `${hits.length}${res.truncated ? '+' : ''} match${hits.length === 1 ? '' : 'es'}${hits.length ? ` in ${files} file${files === 1 ? '' : 's'}` : ''}`
    })
  }

  d.input.onkeydown = (e) => {
    if (e.key === 'Enter') void search().catch(() => undefined) // reported by guard
  }
  d.mask.onkeydown = d.input.onkeydown
  for (const [btn] of toggles) {
    btn.onclick = () => {
      btn.classList.toggle('on')
      if (d.input.value) void search().catch(() => undefined)
    }
  }

  d.replaceBtn.onclick = () => {
    if (!fromSearch || !hits.length) return d.report('Search first, then Replace All', true)
    const root = d.getRoot()
    if (!root) return
    const paths = [...new Set(hits.map((h) => h.path))]
    const replacement = d.replaceInput.value
    if (!confirm(`Replace ${hits.length} match${hits.length === 1 ? '' : 'es'} in ${paths.length} file${paths.length === 1 ? '' : 's'} with "${replacement}"?`)) return
    void d
      .guard('Replace in project', async () => {
        const re = pattern(lastQuery, lastOptions)
        const withText = lastOptions.regex ? replacement : replacement.replace(/\$/g, '$$$$')
        const closed: string[] = []
        let done = 0
        for (const p of paths) {
          const open = d.openText(p)
          if (open === undefined) {
            closed.push(p)
            continue
          }
          let n = 0
          const next = open.replace(re, (m) => {
            n++
            return m.replace(new RegExp(re.source, re.flags.replace('g', '')), withText)
          })
          if (n) {
            d.setOpenText(p, next) // in the editor: undoable, and it is up to you to save
            done += n
          }
        }
        if (closed.length) done += await window.forge.replaceInFiles(lastQuery, lastOptions, replacement, closed)
        d.report(`Replaced ${done} match${done === 1 ? '' : 'es'}${paths.length > closed.length ? ' (open files are changed in the editor — save them)' : ''}`)
        await search()
      })
      .catch(() => undefined) // reported by guard
  }

  return {
    search,
    async searchFor(query, opts = {}) {
      d.input.value = query
      d.regexBtn.classList.toggle('on', !!opts.regex)
      await search()
    },
    /** Shows results that came from somewhere else (e.g. Find Usages), highlighting `query` on each line. */
    show(title, query, list) {
      runId++ // an in-flight text search must not overwrite these
      fromSearch = false
      hits = list
      render(query, list)
      d.count.textContent = title
    }
  }
}
