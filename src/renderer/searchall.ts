import { commands, effectiveKeys, type Command } from './commands'
import { fileIcon } from './icons'
import type { SymbolHit } from './lsp'
import { fuzzy } from './search'
import { session } from './session'
import { symbolBadge } from './structure'

// Search Everywhere: one box for files, symbols (classes, functions ... from the language servers) and actions.
// Double Shift opens it on "All"; Tab switches scope. Ctrl+Shift+N, Ctrl+N, Ctrl+Alt+Shift+N and Ctrl+Shift+A open it
// straight on Files, Classes, Symbols and Actions.

export type SearchScope = 'all' | 'files' | 'symbols' | 'actions'
const SCOPES: [SearchScope, string][] = [
  ['all', 'All'],
  ['files', 'Files'],
  ['symbols', 'Symbols'],
  ['actions', 'Actions']
]

// LSP SymbolKind values that count as "classes": Module, Namespace, Class, Enum, Interface, Struct.
const CLASS_KINDS = new Set([2, 3, 5, 10, 11, 23])

export interface SearchDeps {
  getRoot: () => string | null
  relPath: (path: string) => string
  openFile: (path: string, line?: number, column?: number) => Promise<void>
  listFiles: (root: string) => Promise<string[]>
  symbols: (query: string) => Promise<SymbolHit[]>
  report: (msg: string, isError?: boolean) => void
  /** What to focus again when the popup closes. */
  restoreFocus: () => void
}

export interface SearchEverywhere {
  open: (scope?: SearchScope, opts?: { classesOnly?: boolean }) => Promise<void>
  close: () => void
  isOpen: () => boolean
}

interface Row {
  section: string
  label: string
  idx: number[]
  detail?: string
  keys?: string
  icon?: string
  run: () => void
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}
const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function initSearchEverywhere(deps: SearchDeps): SearchEverywhere {
  const overlay = byId('search')
  const input = byId<HTMLInputElement>('search-input')
  const results = byId('search-results')
  const scopesEl = byId('search-scopes')

  let scope: SearchScope = 'all'
  let classesOnly = false
  let fileIndex: string[] = []
  let indexed = false
  let symbolHits: SymbolHit[] = []
  let symbolQuery = ''
  let symbolError: string | null = null
  let rows: Row[] = []
  let selected = 0
  let seq = 0
  let timer: number | undefined

  const rootless = (): boolean => deps.getRoot() === null

  function fileRows(q: string, limit: number): Row[] {
    const scored: { path: string; idx: number[]; score: number }[] = []
    if (!q) {
      // Nothing typed: recent files first, then the rest of the project.
      const recent = (session.get().recentFiles ?? []).filter((p) => fileIndex.some((f) => f.toLowerCase() === p.toLowerCase()))
      const seen = new Set(recent.map((p) => p.toLowerCase()))
      for (const p of recent) scored.push({ path: p, idx: [], score: 0 })
      for (const p of fileIndex) if (!seen.has(p.toLowerCase())) scored.push({ path: p, idx: [], score: 0 })
    } else {
      for (const p of fileIndex) {
        const rel = deps.relPath(p)
        const m = fuzzy(q, rel)
        if (!m) continue
        // Prefer matches that land in the file name over matches in the directory path.
        const nameStart = rel.length - basename(rel).length
        const inName = m.idx.filter((i) => i >= nameStart).length
        scored.push({ path: p, idx: m.idx, score: m.score + inName * 6 })
      }
      scored.sort((a, b) => b.score - a.score)
    }
    return scored.slice(0, limit).map(({ path, idx }) => {
      const rel = deps.relPath(path)
      const nameStart = rel.length - basename(rel).length
      return {
        section: 'Files',
        label: basename(rel),
        idx: idx.filter((i) => i >= nameStart).map((i) => i - nameStart),
        detail: rel.slice(0, Math.max(0, nameStart - 1)),
        icon: fileIcon(basename(rel)),
        run: () => void deps.openFile(path).catch(() => undefined) // reported by the opener
      }
    })
  }

  function symbolRows(q: string, limit: number): Row[] {
    if (!q) return []
    const hits = symbolHits
      .filter((h) => !classesOnly || CLASS_KINDS.has(h.kind))
      .map((h) => ({ h, m: fuzzy(q, h.name) }))
      .filter((x): x is { h: SymbolHit; m: NonNullable<ReturnType<typeof fuzzy>> } => x.m !== null)
      .sort((a, b) => b.m.score - a.m.score)
      .slice(0, limit)
    return hits.map(({ h, m }) => {
      const badge = symbolBadge(h.kind - 1)
      return {
        section: classesOnly ? 'Classes' : 'Symbols',
        label: h.name,
        idx: m.idx,
        detail: `${h.container ? h.container + ' · ' : ''}${deps.relPath(h.path)}:${h.line}`,
        icon: `<span class="kind" style="--k:${badge.color}">${badge.letter}</span>`,
        run: () => void deps.openFile(h.path, h.line, h.column).catch(() => undefined)
      }
    })
  }

  function actionRows(q: string, limit: number): Row[] {
    const all = commands()
    const matched = q
      ? all
          .map((cmd) => ({ cmd, m: fuzzy(q, `${cmd.category}: ${cmd.title}`) }))
          .filter((x): x is { cmd: Command; m: NonNullable<ReturnType<typeof fuzzy>> } => x.m !== null)
          .sort((a, b) => b.m.score - a.m.score)
      : all.map((cmd) => ({ cmd, m: { idx: [] as number[], score: 0 } }))
    return matched.slice(0, limit).map(({ cmd, m }) => {
      const offset = cmd.category.length + 2
      return {
        section: 'Actions',
        label: cmd.title,
        idx: m.idx.filter((i) => i >= offset).map((i) => i - offset),
        detail: cmd.category,
        keys: effectiveKeys(cmd),
        run: () =>
          void Promise.resolve()
            .then(() => cmd.run())
            .catch((err: unknown) => deps.report(`${cmd.title}: ${err instanceof Error ? err.message : String(err)}`, true))
      }
    })
  }

  function compute(): void {
    const q = input.value.trim()
    if (scope === 'files') rows = fileRows(q, 60)
    else if (scope === 'symbols') rows = symbolRows(q, 60)
    else if (scope === 'actions') rows = actionRows(q, 80)
    else rows = [...fileRows(q, q ? 8 : 12), ...(q ? [...symbolRows(q, 8), ...actionRows(q, 6)] : [])]
    selected = 0
    render()
  }

  function hint(text: string): void {
    const h = document.createElement('div')
    h.className = 'hint'
    h.textContent = text
    results.append(h)
  }

  function render(): void {
    results.replaceChildren()
    if (rootless() && scope !== 'actions') {
      if (scope === 'files' || scope === 'symbols') return hint('Open a folder first (Ctrl+O)')
      if (!rows.length) hint('Open a folder first (Ctrl+O) — actions can still be searched')
    }
    if (symbolError && (scope === 'symbols' || scope === 'all')) hint(`Symbol search failed: ${symbolError}`)
    if (!rows.length && !results.childElementCount) {
      return hint(!indexed && scope === 'files' ? 'Indexing the project…' : scope === 'symbols' && !input.value.trim() ? 'Type a name to search symbols' : 'Nothing found')
    }
    let section = ''
    rows.forEach((row, i) => {
      const el = document.createElement('div')
      el.className = 'result' + (i === selected ? ' sel' : '')
      el.style.setProperty('--i', String(Math.min(i, 14)))
      if (row.section !== section) {
        // The section title is drawn by CSS, so it is not part of the row's text.
        el.dataset['section'] = row.section
        section = row.section
      }
      const left = document.createElement('span')
      left.className = 'qleft'
      if (row.icon) left.insertAdjacentHTML('beforeend', row.icon)
      const label = document.createElement('span')
      for (let c = 0; c < row.label.length; c++) {
        const ch = row.label[c] ?? ''
        if (row.idx.includes(c)) {
          const mk = document.createElement('mark')
          mk.textContent = ch
          label.append(mk)
        } else label.append(ch)
      }
      left.append(label)
      el.append(left)
      if (row.keys) {
        const keys = document.createElement('span')
        keys.className = 'keys'
        for (const k of row.keys.split('+')) {
          const kbd = document.createElement('kbd')
          kbd.textContent = k
          keys.append(kbd)
        }
        el.append(keys)
      } else if (row.detail) {
        const d = document.createElement('span')
        d.className = 'dir'
        d.textContent = row.detail
        el.append(d)
      }
      el.onclick = () => choose(i)
      el.onmouseenter = () => {
        if (selected !== i) {
          selected = i
          mark()
        }
      }
      results.append(el)
    })
  }

  const mark = (): void => {
    results.querySelectorAll('.result').forEach((el, i) => el.classList.toggle('sel', i === selected))
    results.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
  }

  function drawScopes(): void {
    scopesEl.replaceChildren(
      ...SCOPES.map(([id, label]) => {
        const b = document.createElement('button')
        b.className = 'scope-chip' + (id === scope ? ' on' : '')
        b.textContent = id === 'symbols' && classesOnly ? 'Classes' : label
        b.dataset['scope'] = id
        b.onclick = () => {
          setScope(id)
          input.focus()
        }
        return b
      })
    )
  }

  function setScope(next: SearchScope): void {
    scope = next
    if (next !== 'symbols') classesOnly = false
    drawScopes()
    compute()
    askSymbols()
  }

  /** Symbols come from the language servers, so they arrive a moment after typing stops. */
  function askSymbols(): void {
    window.clearTimeout(timer)
    const q = input.value.trim()
    if ((scope !== 'symbols' && scope !== 'all') || !q || rootless()) return
    timer = window.setTimeout(() => {
      const mine = ++seq
      deps
        .symbols(q)
        .then((hits) => {
          if (mine !== seq || overlay.hidden) return
          symbolHits = hits
          symbolQuery = q
          symbolError = null
          compute()
        })
        .catch((err: unknown) => {
          if (mine !== seq) return
          symbolError = err instanceof Error ? err.message : String(err)
          compute()
        })
    }, 180)
  }

  function choose(i: number): void {
    const row = rows[i]
    if (!row) return
    close()
    row.run()
  }

  function close(): void {
    window.clearTimeout(timer)
    seq++
    overlay.hidden = true
  }

  input.oninput = () => {
    compute()
    askSymbols()
  }
  input.onkeydown = (e) => {
    if (e.key === 'Escape') {
      close()
      deps.restoreFocus()
    } else if (e.key === 'Enter') choose(selected)
    else if (e.key === 'Tab') {
      e.preventDefault()
      const at = SCOPES.findIndex(([id]) => id === scope)
      setScope(SCOPES[(at + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length]![0])
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!rows.length) return
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
      mark()
    }
  }
  overlay.onmousedown = (e) => {
    if (e.target === overlay) {
      close()
      deps.restoreFocus()
    }
  }

  return {
    async open(next = 'all', opts = {}) {
      scope = next
      classesOnly = !!opts.classesOnly
      overlay.hidden = false
      input.value = ''
      input.focus()
      symbolHits = []
      symbolQuery = ''
      symbolError = null
      fileIndex = []
      indexed = false
      drawScopes()
      compute()
      const root = deps.getRoot()
      if (!root) return
      try {
        const files = await deps.listFiles(root)
        // The user may have closed the box or opened another folder while indexing.
        if (overlay.hidden || deps.getRoot() !== root) return
        fileIndex = files
        indexed = true
        compute()
      } catch (err) {
        const msg = `Index project: ${err instanceof Error ? err.message : String(err)}`
        deps.report(msg, true)
        throw err
      }
    },
    close,
    isOpen: () => !overlay.hidden
  }
}
