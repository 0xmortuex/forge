import * as monaco from 'monaco-editor'

// The breadcrumb bar above the editor: the file's path inside the project, then the chain of symbols
// (class > method) around the cursor. Clicking a symbol jumps to it.

type Symbol = monaco.languages.DocumentSymbol

export interface BreadcrumbDeps {
  el: HTMLElement
  editor: monaco.editor.IStandaloneCodeEditor
  /** Path of the file in the editor, relative to the project; null when the editor isn't showing a file. */
  currentPath: () => string | null
  getSymbols: (model: monaco.editor.ITextModel) => Promise<Symbol[] | null>
}

export interface Breadcrumbs {
  /** Redraws for whatever the editor shows now (call when the active tab changes). */
  refresh: () => void
}

/** The symbols whose range contains `pos`, outermost first. */
export function symbolChain(symbols: Symbol[], pos: monaco.IPosition): Symbol[] {
  const chain: Symbol[] = []
  let level = symbols
  for (;;) {
    // Several siblings can't contain the same position unless the server is sloppy; take the smallest.
    const hit = level
      .filter((s) => monaco.Range.containsPosition(s.range, pos))
      .sort((a, b) => a.range.endLineNumber - a.range.startLineNumber - (b.range.endLineNumber - b.range.startLineNumber))[0]
    if (!hit) return chain
    chain.push(hit)
    level = hit.children ?? []
  }
}

export function initBreadcrumbs(deps: BreadcrumbDeps): Breadcrumbs {
  const { el, editor } = deps
  let symbols: Symbol[] = []
  let seq = 0
  let timer: number | undefined

  const crumb = (text: string, cls: string): HTMLElement => {
    const c = document.createElement('span')
    c.className = `crumb ${cls}`
    c.textContent = text
    return c
  }
  const sep = (): HTMLElement => crumb('›', 'sep')

  function draw(): void {
    const path = deps.currentPath()
    el.hidden = path === null
    if (path === null) return
    const parts = path.split(/[\\/]/)
    const nodes: HTMLElement[] = []
    parts.forEach((p, i) => {
      if (i) nodes.push(sep())
      nodes.push(crumb(p, i === parts.length - 1 ? 'file' : 'dir'))
    })
    const pos = editor.getPosition()
    for (const s of pos ? symbolChain(symbols, pos) : []) {
      const c = crumb(s.name, 'sym')
      c.title = s.detail || s.name
      c.onclick = () => {
        editor.setPosition({ lineNumber: s.selectionRange.startLineNumber, column: s.selectionRange.startColumn })
        editor.revealRangeInCenterIfOutsideViewport(s.selectionRange)
        editor.focus()
      }
      nodes.push(sep(), c)
    }
    el.replaceChildren(...nodes)
    el.scrollLeft = el.scrollWidth // a long chain keeps the innermost symbol in view
  }

  async function load(): Promise<void> {
    const mine = ++seq
    const model = deps.currentPath() !== null ? editor.getModel() : null
    if (!model) {
      symbols = []
      return draw()
    }
    try {
      const res = await deps.getSymbols(model)
      if (mine !== seq) return
      symbols = res ?? []
    } catch {
      // The language server's failure was already reported where it happened; the bar just shows the path.
      if (mine !== seq) return
      symbols = []
    }
    draw()
  }

  editor.onDidChangeModel(() => {
    symbols = []
    draw()
    void load()
  })
  editor.onDidChangeModelContent(() => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void load(), 600)
  })
  let cursorTimer: number | undefined
  editor.onDidChangeCursorPosition(() => {
    window.clearTimeout(cursorTimer)
    cursorTimer = window.setTimeout(draw, 60)
  })

  return {
    refresh() {
      draw()
      void load()
    }
  }
}
