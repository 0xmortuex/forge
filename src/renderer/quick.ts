import { fuzzy } from './search'

// A small, reusable "pick from a list" popup (Recent Files, Recent Locations, Bookmarks ...): a filter box over a list,
// arrow keys to move, Enter to choose, Escape to close. One is open at a time.

export interface QuickItem<T> {
  label: string
  /** Shown dimmed on the right (usually a path). Also matched by the filter. */
  detail?: string
  /** HTML for a leading icon. */
  icon?: string
  data: T
}

export interface QuickOptions<T> {
  title: string
  placeholder?: string
  items: QuickItem<T>[]
  onChoose: (data: T) => void
  /** Shown when nothing matches (or there are no items). */
  emptyText?: string
  /** Which row starts selected (default: the first). */
  selected?: number
  /** Extra actions for a row: right-click, or the right arrow key. `at` is where to show a menu. */
  onContext?: (data: T, at: { x: number; y: number }) => void
}

const byId = <E extends HTMLElement>(id: string): E => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as E
}

const overlay = byId('quick')
const titleEl = byId('quick-title')
const input = byId<HTMLInputElement>('quick-input')
const results = byId('quick-results')

let restoreFocus: () => void = () => undefined
/** Called once at startup: what to focus again when the popup closes without a choice. */
export function initQuick(deps: { restoreFocus: () => void }): void {
  restoreFocus = deps.restoreFocus
}

export const quickIsOpen = (): boolean => !overlay.hidden

function close(): void {
  overlay.hidden = true
  input.oninput = null
  input.onkeydown = null
  overlay.onmousedown = null
}

export function quickPick<T>(opts: QuickOptions<T>): void {
  let shown: { item: QuickItem<T>; idx: number[] }[] = []
  let selected = 0

  function filter(): void {
    const q = input.value.trim()
    if (!q) shown = opts.items.map((item) => ({ item, idx: [] }))
    else {
      shown = opts.items
        .map((item) => {
          const m = fuzzy(q, item.label)
          if (m) return { item, idx: m.idx, score: m.score + 10 } // a hit in the name beats one in the path
          const d = item.detail ? fuzzy(q, item.detail) : null
          return d ? { item, idx: [] as number[], score: d.score } : null
        })
        .filter((x): x is { item: QuickItem<T>; idx: number[]; score: number } => x !== null)
        .sort((a, b) => b.score - a.score)
    }
    shown = shown.slice(0, 100)
    selected = 0
    render()
  }

  function render(): void {
    results.replaceChildren()
    if (!shown.length) {
      const h = document.createElement('div')
      h.className = 'hint'
      h.textContent = opts.emptyText ?? 'Nothing to show'
      results.append(h)
      return
    }
    shown.forEach(({ item, idx }, i) => {
      const row = document.createElement('div')
      row.className = 'result' + (i === selected ? ' sel' : '')
      row.style.setProperty('--i', String(Math.min(i, 12)))
      const left = document.createElement('span')
      left.className = 'qleft'
      if (item.icon) left.insertAdjacentHTML('beforeend', item.icon)
      const label = document.createElement('span')
      for (let c = 0; c < item.label.length; c++) {
        const ch = item.label[c] ?? ''
        if (idx.includes(c)) {
          const mk = document.createElement('mark')
          mk.textContent = ch
          label.append(mk)
        } else label.append(ch)
      }
      left.append(label)
      row.append(left)
      if (item.detail) {
        const d = document.createElement('span')
        d.className = 'dir'
        d.textContent = item.detail
        row.append(d)
      }
      row.onclick = () => choose(i)
      if (opts.onContext) {
        row.classList.add('has-ctx')
        row.oncontextmenu = (ev) => {
          ev.preventDefault()
          context(i, ev.clientX, ev.clientY)
        }
      }
      row.onmouseenter = () => {
        if (selected !== i) {
          selected = i
          mark()
        }
      }
      results.append(row)
    })
  }

  const mark = (): void => {
    results.querySelectorAll('.result').forEach((el, i) => el.classList.toggle('sel', i === selected))
    results.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
  }

  /** Runs a row's extra actions; the popup stays open behind the menu until one is picked. */
  function context(i: number, x: number, y: number): void {
    const hit = shown[i]
    if (!hit || !opts.onContext) return
    close()
    opts.onContext(hit.item.data, { x, y })
  }

  function choose(i: number): void {
    const hit = shown[i]
    if (!hit) return
    close()
    opts.onChoose(hit.item.data)
  }

  titleEl.textContent = opts.title
  input.placeholder = opts.placeholder ?? 'Type to filter'
  input.value = ''
  overlay.hidden = false
  input.focus()
  filter()
  if (opts.selected !== undefined && opts.selected < shown.length) {
    selected = opts.selected
    mark()
  }

  input.oninput = filter
  input.onkeydown = (e) => {
    if (e.key === 'Escape') {
      close()
      restoreFocus()
    } else if (e.key === 'Enter') choose(selected)
    else if (e.key === 'ArrowRight' && opts.onContext && input.selectionStart === input.value.length) {
      const box = results.querySelector('.sel')?.getBoundingClientRect()
      if (box) context(selected, box.right - 40, box.top + box.height)
    }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!shown.length) return
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length
      mark()
    }
  }
  overlay.onmousedown = (e) => {
    if (e.target === overlay) {
      close()
      restoreFocus()
    }
  }
}
