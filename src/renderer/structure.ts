import * as monaco from 'monaco-editor'
import { icons } from './icons'

// The Structure window: the active file's symbols (classes, functions, ...) as a tree, from the language server.
// It follows the cursor, filters as you type, and jumps to a symbol when you click it.

type Symbol = monaco.languages.DocumentSymbol

export interface StructureDeps {
  /** Where the window's content goes (the window's own root element). */
  root: HTMLElement
  editor: monaco.editor.IStandaloneCodeEditor
  /** The file's symbols; null when no language server handles it. */
  getSymbols: (model: monaco.editor.ITextModel) => Promise<Symbol[] | null>
  /** Whether the window is on screen; nothing is requested while it is hidden. */
  isVisible: () => boolean
}

const SK = monaco.languages.SymbolKind
// How each kind of symbol is drawn: a letter in a rounded square, colored like the matching syntax.
const KIND: Partial<Record<monaco.languages.SymbolKind, { letter: string; color: string }>> = {
  [SK.Class]: { letter: 'C', color: 'var(--syn-type)' },
  [SK.Interface]: { letter: 'I', color: 'var(--info)' },
  [SK.Enum]: { letter: 'E', color: 'var(--syn-type)' },
  [SK.EnumMember]: { letter: 'e', color: 'var(--syn-const)' },
  [SK.Struct]: { letter: 'S', color: 'var(--syn-type)' },
  [SK.Method]: { letter: 'm', color: 'var(--syn-func)' },
  [SK.Function]: { letter: 'f', color: 'var(--syn-func)' },
  [SK.Constructor]: { letter: 'c', color: 'var(--syn-func)' },
  [SK.Property]: { letter: 'p', color: 'var(--ok)' },
  [SK.Field]: { letter: 'f', color: 'var(--ok)' },
  [SK.Variable]: { letter: 'v', color: 'var(--syn-number)' },
  [SK.Constant]: { letter: 'c', color: 'var(--syn-const)' },
  [SK.Module]: { letter: 'M', color: 'var(--syn-keyword)' },
  [SK.Namespace]: { letter: 'N', color: 'var(--syn-keyword)' },
  [SK.Package]: { letter: 'P', color: 'var(--syn-keyword)' },
  [SK.TypeParameter]: { letter: 'T', color: 'var(--syn-type)' }
}

/** How a kind of symbol is drawn (a letter on a tinted square). `kind` is Monaco's SymbolKind (LSP's minus one). */
export function symbolBadge(kind: number): { letter: string; color: string } {
  return KIND[kind as monaco.languages.SymbolKind] ?? { letter: '·', color: 'var(--text-dim)' }
}

const contains = (r: monaco.IRange, p: monaco.IPosition): boolean =>
  monaco.Range.containsPosition(r, p)

export interface StructureView {
  /** Re-reads the active file's symbols (resolves when the tree is drawn). */
  refresh: () => Promise<void>
}

export function initStructure(deps: StructureDeps): StructureView {
  const { root, editor } = deps

  const bar = document.createElement('div')
  bar.className = 'tool-bar'
  const filter = document.createElement('input')
  filter.className = 'field tool-filter'
  filter.placeholder = 'Filter'
  filter.spellcheck = false
  const mkBtn = (title: string, html: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.className = 'icon-btn small'
    b.title = title
    b.innerHTML = html
    return b
  }
  const sortBtn = mkBtn('Sort alphabetically', icons.sort)
  const expandBtn = mkBtn('Expand all', icons.expandAll)
  const collapseBtn = mkBtn('Collapse all', icons.collapseAll)
  bar.append(filter, sortBtn, expandBtn, collapseBtn)
  const list = document.createElement('div')
  list.id = 'structure-list'
  list.className = 'tool-list'
  root.replaceChildren(bar, list)

  let symbols: Symbol[] = []
  let message = 'Open a file to see its structure'
  let sorted = false
  const collapsed = new Set<string>() // path of symbol names, so folding survives a refresh
  let seq = 0
  let timer: number | undefined

  const rows: { sym: Symbol; row: HTMLElement }[] = []

  function draw(): void {
    list.replaceChildren()
    rows.length = 0
    const q = filter.value.trim().toLowerCase()
    const matches = (s: Symbol): boolean => !q || s.name.toLowerCase().includes(q) || (s.children ?? []).some(matches)
    const build = (items: Symbol[], into: HTMLElement, depth: number, path: string): void => {
      // Servers differ in the order they list symbols in (tsserver sorts by name), so source order is made explicit.
      const bySource = (a: Symbol, b: Symbol): number =>
        a.range.startLineNumber - b.range.startLineNumber || a.range.startColumn - b.range.startColumn
      const ordered = [...items].sort(sorted ? (a, b) => a.name.localeCompare(b.name) : bySource)
      for (const s of ordered) {
        if (!matches(s)) continue
        const key = `${path}/${s.name}`
        const kids = s.children ?? []
        const row = document.createElement('div')
        row.className = 'sym'
        row.style.paddingLeft = `${depth * 14 + 6}px`
        row.dataset['line'] = String(s.selectionRange.startLineNumber)
        const open = !!q || !collapsed.has(key)
        const twisty = document.createElement('span')
        twisty.className = 'twisty'
        if (kids.length) twisty.innerHTML = open ? icons.chevronDown : icons.chevronRight
        const kind = KIND[s.kind] ?? { letter: '·', color: 'var(--text-dim)' }
        const badge = document.createElement('span')
        badge.className = 'kind'
        badge.textContent = kind.letter
        badge.style.setProperty('--k', kind.color)
        const name = document.createElement('span')
        name.className = 'sname' + (s.tags?.includes(monaco.languages.SymbolTag.Deprecated) ? ' deprecated' : '')
        name.textContent = s.name
        row.append(twisty, badge, name)
        if (s.detail) {
          const d = document.createElement('span')
          d.className = 'sdetail'
          d.textContent = s.detail
          row.append(d)
        }
        row.onclick = (e) => {
          if (kids.length && (e.target as HTMLElement).closest('.twisty')) {
            if (collapsed.has(key)) collapsed.delete(key)
            else collapsed.add(key)
            draw()
            return
          }
          const at = s.selectionRange
          editor.setPosition({ lineNumber: at.startLineNumber, column: at.startColumn })
          editor.revealRangeInCenterIfOutsideViewport(at)
          editor.focus()
        }
        into.append(row)
        rows.push({ sym: s, row })
        if (kids.length && open) build(kids, into, depth + 1, key)
      }
    }
    build(symbols, list, 0, '')
    if (!rows.length) {
      const hint = document.createElement('div')
      hint.className = 'hint'
      hint.textContent = symbols.length && q ? 'Nothing matches the filter' : message
      list.append(hint)
    }
    markCurrent()
  }

  /** Highlights the innermost symbol around the cursor. */
  function markCurrent(): void {
    const pos = editor.getPosition()
    let best: { row: HTMLElement; size: number } | undefined
    for (const { sym, row } of rows) {
      row.classList.remove('current')
      if (!pos || !contains(sym.range, pos)) continue
      const size = sym.range.endLineNumber - sym.range.startLineNumber
      if (!best || size <= best.size) best = { row, size }
    }
    if (best) {
      best.row.classList.add('current')
      best.row.scrollIntoView({ block: 'nearest' })
    }
  }

  async function refresh(): Promise<void> {
    const mine = ++seq
    const model = editor.getModel()
    if (!model) {
      symbols = []
      message = 'Open a file to see its structure'
      return draw()
    }
    try {
      const res = await deps.getSymbols(model)
      if (mine !== seq) return // a newer request superseded this one
      symbols = res ?? []
      message = res === null ? `No language server for ${model.getLanguageId()} files` : 'No symbols in this file'
    } catch (err) {
      if (mine !== seq) return
      symbols = []
      message = `Could not read the structure: ${err instanceof Error ? err.message : String(err)}` // the failure itself was reported
    }
    draw()
  }

  const later = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      if (deps.isVisible()) void refresh()
    }, 450)
  }
  editor.onDidChangeModel(() => {
    window.clearTimeout(timer)
    if (deps.isVisible()) void refresh()
  })
  editor.onDidChangeModelContent(later)
  let cursorTimer: number | undefined
  editor.onDidChangeCursorPosition(() => {
    window.clearTimeout(cursorTimer)
    cursorTimer = window.setTimeout(markCurrent, 80)
  })

  filter.oninput = draw
  sortBtn.onclick = () => {
    sorted = !sorted
    sortBtn.classList.toggle('on', sorted)
    draw()
  }
  expandBtn.onclick = () => {
    collapsed.clear()
    draw()
  }
  collapseBtn.onclick = () => {
    const add = (items: Symbol[], path: string): void => {
      for (const s of items) {
        const key = `${path}/${s.name}`
        if (s.children?.length) {
          collapsed.add(key)
          add(s.children, key)
        }
      }
    }
    add(symbols, '')
    draw()
  }

  draw()
  return { refresh }
}
