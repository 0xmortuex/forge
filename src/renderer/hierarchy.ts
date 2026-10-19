import { symbolBadge } from './structure'

// The Hierarchy window: a lazily expanded tree for call hierarchy (who calls this / what does it call) and type
// hierarchy (supertypes / subtypes). The language server supplies the data; each node knows how to load its children.

export interface HierarchyNode {
  name: string
  detail?: string
  /** LSP SymbolKind (1-based). */
  kind: number
  path: string
  line: number
  column: number
  children: () => Promise<HierarchyNode[]>
}

export interface HierarchyRoot {
  title: string
  nodes: HierarchyNode[]
  /** Flips the view (callers <-> callees, supertypes <-> subtypes). */
  toggle?: { label: string; load: () => Promise<HierarchyRoot | null> }
}

export interface HierarchyDeps {
  /** The window's own root element. */
  root: HTMLElement
  openAt: (path: string, line: number, column: number) => Promise<void>
  relPath: (path: string) => string
  /** Brings the window on screen. */
  reveal: () => void
}

export interface HierarchyView {
  show: (root: HierarchyRoot) => void
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function initHierarchy(deps: HierarchyDeps): HierarchyView {
  const bar = document.createElement('div')
  bar.className = 'tool-bar'
  const title = document.createElement('span')
  title.className = 'tool-title'
  const flip = document.createElement('button')
  flip.className = 'btn hier-flip'
  flip.hidden = true
  bar.append(title, flip)
  const list = document.createElement('div')
  list.className = 'tool-list'
  list.id = 'hierarchy-list'
  deps.root.replaceChildren(bar, list)

  const hint = (text: string, cls = 'hint'): HTMLElement => {
    const h = document.createElement('div')
    h.className = cls
    h.textContent = text
    return h
  }
  list.append(hint('Place the cursor on a function or type and run Call Hierarchy (Ctrl+Alt+H).'))

  function addNodes(nodes: HierarchyNode[], into: HTMLElement, depth: number): void {
    for (const node of nodes) {
      const row = document.createElement('div')
      row.className = 'hrow'
      row.style.paddingLeft = `${depth * 14 + 6}px`
      row.dataset['name'] = node.name
      const twisty = document.createElement('span')
      twisty.className = 'twisty'
      twisty.textContent = '›'
      const badge = symbolBadge(node.kind - 1)
      const kind = document.createElement('span')
      kind.className = 'kind'
      kind.textContent = badge.letter
      kind.style.setProperty('--k', badge.color)
      const name = document.createElement('span')
      name.className = 'hname'
      name.textContent = node.name
      const where = document.createElement('span')
      where.className = 'hwhere'
      where.textContent = `${node.detail ? node.detail + '  ' : ''}${basename(deps.relPath(node.path))}:${node.line}`
      row.append(twisty, kind, name, where)
      const kids = document.createElement('div')
      kids.hidden = true
      let loaded = false
      row.onclick = (e) => {
        if ((e.target as HTMLElement).closest('.twisty')) {
          void toggle()
          return
        }
        void deps.openAt(node.path, node.line, node.column).catch(() => undefined) // reported by the opener
      }
      row.ondblclick = () => void toggle()
      async function toggle(): Promise<void> {
        kids.hidden = !kids.hidden
        twisty.classList.toggle('open', !kids.hidden)
        if (kids.hidden || loaded) return
        loaded = true
        kids.append(hint('Loading…', 'hint hloading'))
        try {
          const children = await node.children()
          kids.replaceChildren()
          if (!children.length) kids.append(hint('Nothing further', 'hint hnone'))
          else addNodes(children, kids, depth + 1)
        } catch (err) {
          loaded = false
          kids.replaceChildren(hint(`Could not load: ${err instanceof Error ? err.message : String(err)}`, 'hint herr'))
        }
      }
      into.append(row, kids)
    }
  }

  function show(root: HierarchyRoot): void {
    title.textContent = root.title
    flip.hidden = !root.toggle
    if (root.toggle) {
      const { label, load } = root.toggle
      flip.textContent = label
      flip.onclick = () => {
        void load()
          .then((next) => next && show(next))
          .catch((err: unknown) => list.replaceChildren(hint(`Could not load: ${err instanceof Error ? err.message : String(err)}`, 'hint herr')))
      }
    }
    list.replaceChildren()
    addNodes(root.nodes, list, 0)
    deps.reveal()
    // The roots are open already: the point of the window is their children.
    list.querySelectorAll<HTMLElement>(':scope > .hrow .twisty').forEach((t) => t.click())
  }

  return { show }
}
