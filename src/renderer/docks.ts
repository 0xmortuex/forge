import { showMenu, type MenuItem } from './menu'

// Tool windows live in one of three docks (left, right, bottom). Each dock shows one of its windows at a time,
// with a tab per window; the stripes at the window edges have a button per window. A window can be moved to
// another dock from its context menu, or by dragging its stripe button.

export type DockName = 'left' | 'right' | 'bottom'
const DOCK_NAMES: DockName[] = ['left', 'right', 'bottom']
const DOCK_TITLE: Record<DockName, string> = { left: 'Left', right: 'Right', bottom: 'Bottom' }

export interface ToolWindowDef {
  id: string
  title: string
  icon: string
  /** The element holding the window's content; it is moved into whichever dock the window lives in. */
  root: HTMLElement
  dock: DockName
  /** Shown in the tooltip, e.g. "Alt+1". */
  shortcut?: string
  /** False for windows that start something when shown (a terminal, a run): they are not reopened on their own. */
  passive?: boolean
  onShow?: () => void
}

export interface DockLayout {
  /** Which dock each window is in. */
  docks?: Record<string, string>
  /** The window each dock was showing. */
  active?: Partial<Record<DockName, string>>
  hidden?: Partial<Record<DockName, boolean>>
}

interface Dock {
  name: DockName
  panel: HTMLElement
  splitter: HTMLElement
  tabs: HTMLElement
  active: string | undefined
  userHidden: boolean
}

export interface ToolWindowDeps {
  /** Plays an entrance animation on an element. */
  enter: (el: HTMLElement) => void
  /** Called after anything the session should remember (visibility, placement, sizes) changed. */
  changed: () => void
  /** Elements that make up the dock UI (see index.html). */
  els: {
    left: { panel: HTMLElement; splitter: HTMLElement; tabs: HTMLElement }
    right: { panel: HTMLElement; splitter: HTMLElement; tabs: HTMLElement }
    bottom: { panel: HTMLElement; splitter: HTMLElement; tabs: HTMLElement }
    stripeLeftTop: HTMLElement
    stripeLeftBottom: HTMLElement
    stripeLeft: HTMLElement
    stripeRight: HTMLElement
  }
}

export interface ToolWindows {
  register: (def: ToolWindowDef) => void
  /** Removes a window (and its stripe button); used for windows that extensions add and take away. */
  unregister: (id: string) => void
  setOnShow: (id: string, fn: () => void) => void
  show: (id: string, opts?: { restore?: boolean }) => void
  toggle: (id: string) => void
  hideDock: (dock: DockName) => void
  move: (id: string, dock: DockName) => void
  isOpen: (id: string) => boolean
  dockOf: (id: string) => DockName
  /** Whether a dock is currently showing. */
  dockVisible: (dock: DockName) => boolean
  activeIn: (dock: DockName) => string | undefined
  layout: () => Required<DockLayout>
  restore: (layout: DockLayout) => void
  /** Puts every window back in the dock it was registered in, and shows every dock again. */
  reset: () => void
  /** A small count shown on the window's tab and stripe button (empty text removes it). */
  setBadge: (id: string, text: string, tone?: 'err' | 'warn' | 'info') => void
  /** Re-reads visibility into the stripes and tabs (after something else changed a panel). */
  render: () => void
}

const MIN_SIZE = 120

export function createToolWindows(deps: ToolWindowDeps): ToolWindows {
  const windows = new Map<string, ToolWindowDef & { dock: DockName }>()
  /** The dock each window was registered in, for reset(). */
  const homes = new Map<string, DockName>()
  const docks: Record<DockName, Dock> = {
    left: { name: 'left', ...deps.els.left, active: undefined, userHidden: false },
    right: { name: 'right', ...deps.els.right, active: undefined, userHidden: true },
    bottom: { name: 'bottom', ...deps.els.bottom, active: undefined, userHidden: false }
  }

  const get = (id: string): ToolWindowDef & { dock: DockName } => {
    const w = windows.get(id)
    if (!w) throw new Error(`Unknown tool window: ${id}`)
    return w
  }
  const inDock = (name: DockName): (ToolWindowDef & { dock: DockName })[] => [...windows.values()].filter((w) => w.dock === name)
  const isOpen = (id: string): boolean => {
    const w = get(id)
    const d = docks[w.dock]
    return !d.panel.hidden && d.active === id
  }

  const badges = new Map<string, { text: string; tone: string }>()
  const withBadge = (el: HTMLElement, id: string): void => {
    const badge = badges.get(id)
    if (!badge) return
    const b = document.createElement('span')
    b.className = `badge ${badge.tone}`
    b.textContent = badge.text
    el.append(b)
  }

  const tooltip = (w: ToolWindowDef): string => (w.shortcut ? `${w.title} (${w.shortcut})` : w.title)

  function menuFor(w: ToolWindowDef & { dock: DockName }): (MenuItem | 'sep')[] {
    const items: (MenuItem | 'sep')[] = DOCK_NAMES.filter((n) => n !== w.dock).map((n) => ({
      label: `Move to ${DOCK_TITLE[n]}`,
      run: () => move(w.id, n)
    }))
    items.push('sep', { label: `Hide ${w.title}`, run: () => hideDock(w.dock) })
    return items
  }

  function decorate(el: HTMLElement, w: ToolWindowDef & { dock: DockName }): void {
    el.dataset['win'] = w.id
    el.style.setProperty('--c', `var(--hue-${w.id}, var(--accent))`)
    el.oncontextmenu = (ev) => {
      ev.preventDefault()
      showMenu(ev.clientX, ev.clientY, menuFor(w))
    }
  }

  function render(): void {
    for (const name of DOCK_NAMES) {
      const d = docks[name]
      const wins = inDock(name)
      if (!wins.some((w) => w.id === d.active)) d.active = wins[0]?.id
      d.panel.hidden = d.userHidden || wins.length === 0
      d.splitter.hidden = d.panel.hidden
      d.tabs.replaceChildren()
      for (const w of wins) {
        if (w.root.parentElement !== d.panel) d.panel.append(w.root)
        w.root.hidden = w.id !== d.active
        const tab = document.createElement('button')
        tab.className = 'btab' + (!d.panel.hidden && d.active === w.id ? ' active' : '')
        tab.textContent = w.title
        withBadge(tab, w.id)
        tab.onclick = () => show(w.id)
        decorate(tab, w)
        d.tabs.append(tab)
      }
      // With many windows in one dock the tabs overflow: keep the shown one in view.
      d.tabs.querySelector('.btab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
    const stripeButton = (w: ToolWindowDef & { dock: DockName }): HTMLButtonElement => {
      const b = document.createElement('button')
      b.className = 'tw-btn' + (isOpen(w.id) ? ' active' : '')
      b.innerHTML = w.icon
      withBadge(b, w.id)
      b.title = tooltip(w)
      b.draggable = true
      b.ondragstart = (ev) => {
        ev.dataTransfer?.setData('text/forge-window', w.id)
        document.body.classList.add('dragging-window')
      }
      b.ondragend = () => document.body.classList.remove('dragging-window')
      b.onclick = () => toggle(w.id)
      decorate(b, w)
      return b
    }
    deps.els.stripeLeftTop.replaceChildren(...inDock('left').map(stripeButton))
    deps.els.stripeLeftBottom.replaceChildren(...inDock('bottom').reverse().map(stripeButton))
    const rightWins = inDock('right')
    deps.els.stripeRight.replaceChildren(...rightWins.map(stripeButton))
    deps.els.stripeRight.hidden = rightWins.length === 0
  }

  function show(id: string, opts: { restore?: boolean } = {}): void {
    const w = get(id)
    const d = docks[w.dock]
    const wasHidden = d.panel.hidden
    const switched = d.active !== id
    d.active = id
    d.userHidden = false
    render()
    if (!opts.restore) {
      if (wasHidden) deps.enter(d.panel)
      else if (switched) deps.enter(w.root)
      w.onShow?.()
    }
    deps.changed()
  }

  function toggle(id: string): void {
    if (isOpen(id)) hideDock(get(id).dock)
    else show(id)
  }

  function hideDock(name: DockName): void {
    docks[name].userHidden = true
    render()
    deps.changed()
  }

  function move(id: string, to: DockName): void {
    const w = get(id)
    if (w.dock === to) return
    w.dock = to
    show(id)
  }

  // The mouse wheel scrolls a crowded tab bar sideways.
  for (const name of DOCK_NAMES) {
    const tabs = docks[name].tabs
    tabs.addEventListener('wheel', (e) => {
      if (!e.deltaY || tabs.scrollWidth <= tabs.clientWidth) return
      e.preventDefault()
      tabs.scrollLeft += e.deltaY
    }, { passive: false })
  }

  // ---- Resizing: the left and right docks have a width, the bottom one a height ----
  for (const name of DOCK_NAMES) {
    const d = docks[name]
    d.splitter.onmousedown = (down) => {
      down.preventDefault()
      const vertical = name === 'bottom'
      const start = vertical ? down.clientY : down.clientX
      const startSize = vertical ? d.panel.offsetHeight : d.panel.offsetWidth
      const limit = (vertical ? window.innerHeight : window.innerWidth) * 0.7
      const move = (e: MouseEvent): void => {
        // The left dock grows rightwards; the right dock grows leftwards; the bottom one upwards.
        const delta = name === 'left' ? e.clientX - start : name === 'right' ? start - e.clientX : start - e.clientY
        const size = Math.min(limit, Math.max(MIN_SIZE, startSize + delta))
        d.panel.style[vertical ? 'height' : 'width'] = `${size}px`
      }
      const up = (): void => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        deps.changed()
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }
  }

  // ---- Dragging a stripe button to another edge moves its window ----
  const dropZone = (el: HTMLElement, target: (ev: DragEvent) => DockName): void => {
    el.ondragover = (ev) => {
      if (!ev.dataTransfer?.types.includes('text/forge-window')) return
      ev.preventDefault()
      el.classList.add('drop')
    }
    el.ondragleave = () => el.classList.remove('drop')
    el.ondrop = (ev) => {
      ev.preventDefault()
      el.classList.remove('drop')
      document.body.classList.remove('dragging-window')
      const id = ev.dataTransfer?.getData('text/forge-window')
      if (id && windows.has(id)) move(id, target(ev))
    }
  }
  // The left stripe has two halves: windows dropped on the upper one go to the left dock, the lower one to the bottom dock.
  dropZone(deps.els.stripeLeft, (ev) => {
    const box = deps.els.stripeLeft.getBoundingClientRect()
    return ev.clientY < box.top + box.height / 2 ? 'left' : 'bottom'
  })
  dropZone(deps.els.stripeRight, () => 'right')

  return {
    register(def) {
      if (windows.has(def.id)) throw new Error(`Tool window registered twice: ${def.id}`)
      windows.set(def.id, { ...def })
      homes.set(def.id, def.dock)
      render()
    },
    unregister(id) {
      const w = get(id)
      windows.delete(id)
      homes.delete(id)
      badges.delete(id)
      if (docks[w.dock].active === id) docks[w.dock].active = undefined
      w.root.remove()
      render()
    },
    setOnShow(id, fn) {
      get(id).onShow = fn
    },
    show,
    toggle,
    hideDock,
    move,
    isOpen,
    dockOf: (id) => get(id).dock,
    dockVisible: (name) => !docks[name].panel.hidden,
    activeIn: (name) => docks[name].active,
    layout() {
      const placement: Record<string, DockName> = {}
      for (const w of windows.values()) placement[w.id] = w.dock
      return {
        docks: placement,
        active: { left: docks.left.active ?? '', right: docks.right.active ?? '', bottom: docks.bottom.active ?? '' },
        hidden: { left: docks.left.userHidden, right: docks.right.userHidden, bottom: docks.bottom.userHidden }
      }
    },
    restore(l) {
      for (const [id, dock] of Object.entries(l.docks ?? {})) {
        const w = windows.get(id)
        if (w && DOCK_NAMES.includes(dock as DockName)) w.dock = dock as DockName
      }
      for (const name of DOCK_NAMES) {
        const wanted = l.active?.[name]
        const w = wanted ? windows.get(wanted) : undefined
        // A terminal, run or debug session shouldn't start unasked, so those are not brought back as the shown tab.
        if (w && w.dock === name && w.passive !== false) docks[name].active = w.id
        const hidden = l.hidden?.[name]
        if (typeof hidden === 'boolean') docks[name].userHidden = hidden
      }
      render()
    },
    reset() {
      for (const [id, home] of homes) get(id).dock = home
      for (const name of DOCK_NAMES) {
        docks[name].active = undefined
        docks[name].userHidden = false
      }
      render()
    },
    setBadge(id, text, tone = 'info') {
      get(id)
      const had = badges.get(id)
      if (!text) badges.delete(id)
      else badges.set(id, { text, tone })
      if (had?.text !== text || had?.tone !== tone) render()
    },
    render
  }
}
