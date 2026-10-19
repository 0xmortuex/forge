// The TODO window: every TODO / FIXME / HACK / XXX comment in the project, grouped by keyword, click to jump.

export interface TodoDeps {
  /** The window's own root element. */
  root: HTMLElement
  getRoot: () => string | null
  relPath: (p: string) => string
  openAt: (path: string, line: number, column?: number) => Promise<void>
  report: (msg: string, isError?: boolean) => void
  /** Told how many items there are (for a badge). */
  onCount: (n: number) => void
}

const WORDS = ['TODO', 'FIXME', 'HACK', 'XXX'] as const
const COLORS: Record<string, string> = { TODO: 'var(--info)', FIXME: 'var(--err)', HACK: 'var(--warn)', XXX: 'var(--syn-keyword)' }

export interface TodoView {
  refresh: () => Promise<void>
}

export function initTodo(d: TodoDeps): TodoView {
  const bar = document.createElement('div')
  bar.className = 'tool-bar'
  const title = document.createElement('span')
  title.className = 'tool-title'
  title.textContent = 'TODO'
  const reload = document.createElement('button')
  reload.className = 'btn'
  reload.textContent = 'Scan'
  bar.append(title, reload)
  const list = document.createElement('div')
  list.className = 'tool-list'
  list.id = 'todo-list'
  d.root.replaceChildren(bar, list)

  const hint = (text: string): void => {
    const h = document.createElement('div')
    h.className = 'hint'
    h.textContent = text
    list.replaceChildren(h)
  }
  hint('Press Scan to look for TODO, FIXME, HACK and XXX comments.')

  async function refresh(): Promise<void> {
    const root = d.getRoot()
    if (!root) return hint('Open a folder first (Ctrl+O)')
    list.replaceChildren()
    title.textContent = 'TODO — scanning…'
    const res = await window.forge.search(root, `\\b(${WORDS.join('|')})\\b`, { regex: true, caseSensitive: true })
    d.onCount(res.hits.length)
    title.textContent = `TODO — ${res.hits.length}${res.truncated ? '+' : ''}`
    if (!res.hits.length) return hint('Nothing to do. Nice.')
    for (const h of res.hits) {
      const word = WORDS.find((w) => h.text.includes(w)) ?? 'TODO'
      const row = document.createElement('div')
      row.className = 'todo'
      const tag = document.createElement('span')
      tag.className = 'todo-tag'
      tag.textContent = word
      tag.style.setProperty('--k', COLORS[word] ?? 'var(--info)')
      const at = h.text.indexOf(word)
      const text = document.createElement('span')
      text.className = 'todo-text'
      text.textContent = h.text.slice(at + word.length).replace(/^[\s:()-]+/, '') || h.text
      const where = document.createElement('span')
      where.className = 'todo-where'
      where.textContent = `${d.relPath(h.path)}:${h.line}`
      row.append(tag, text, where)
      row.onclick = () => void d.openAt(h.path, h.line, h.col).catch(() => undefined) // reported by the opener
      list.append(row)
    }
  }
  reload.onclick = () => void refresh().catch((e: unknown) => d.report(`TODO scan: ${e instanceof Error ? e.message : String(e)}`, true))
  return { refresh }
}
