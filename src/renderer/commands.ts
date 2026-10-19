import { fuzzy } from './search'

/** Something the user can do: shown in the Command Palette and the Settings keymap. */
export interface Command {
  id: string
  title: string
  category: string
  /** Display only (e.g. "Ctrl+Shift+P"); the real key handling lives next to the feature. */
  keys?: string
  run: () => void | Promise<void>
  /** Called while the item is highlighted in the palette, so choices can be tried before committing. */
  preview?: () => void
  /** Undoes `preview` if the palette is dismissed without choosing. */
  revert?: () => void
}

/** Shortcuts the user assigned (command id -> "Ctrl+Alt+M"); see keymap.ts. */
export const customKeys = new Map<string, string>()

/** The shortcut to show for a command: the user's own if they set one, else the default. */
export const effectiveKeys = (c: Command): string | undefined => customKeys.get(c.id) ?? c.keys

const registry = new Map<string, Command>()
const recent: string[] = [] // most recent first

export function register(c: Command): void {
  if (registry.has(c.id)) throw new Error(`Duplicate command id: ${c.id}`)
  registry.set(c.id, c)
}
export function unregister(id: string): void {
  registry.delete(id)
  customKeys.delete(id)
}
export const commands = (): Command[] => [...registry.values()]
export const commandById = (id: string): Command | undefined => registry.get(id)

export interface PaletteDeps {
  /** Errors from commands are shown here (never swallowed). */
  report: (msg: string, isError?: boolean) => void
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

export function initPalette(deps: PaletteDeps): { open: (query?: string) => void; close: () => void; isOpen: () => boolean } {
  const overlay = byId('palette')
  const input = byId<HTMLInputElement>('palette-input')
  const results = byId('palette-results')
  let shown: { cmd: Command; idx: number[] }[] = []
  let selected = 0
  let previewed: Command | null = null
  let previewTimer: number | undefined

  function filter(): void {
    const q = input.value.trim()
    const all = commands()
    if (!q) {
      // No query: recently used first, then everything in registration order.
      const rank = (c: Command): number => {
        const i = recent.indexOf(c.id)
        return i < 0 ? 1e6 : i
      }
      shown = [...all].sort((a, b) => rank(a) - rank(b)).map((cmd) => ({ cmd, idx: [] }))
    } else {
      shown = all
        .map((cmd) => {
          const m = fuzzy(q, `${cmd.category}: ${cmd.title}`)
          return m ? { cmd, idx: m.idx, score: m.score } : null
        })
        .filter((x): x is { cmd: Command; idx: number[]; score: number } => x !== null)
        .sort((a, b) => b.score - a.score)
    }
    shown = shown.slice(0, 80)
    selected = 0
    render()
    schedulePreview()
  }

  function render(): void {
    results.replaceChildren()
    if (!shown.length) {
      const h = document.createElement('div')
      h.className = 'hint'
      h.textContent = 'No matching commands'
      results.append(h)
      return
    }
    shown.forEach(({ cmd, idx }, i) => {
      const row = document.createElement('div')
      row.className = 'result' + (i === selected ? ' sel' : '')
      row.style.setProperty('--i', String(Math.min(i, 12)))
      const left = document.createElement('span')
      const cat = document.createElement('span')
      cat.className = 'cat'
      cat.textContent = cmd.category
      left.append(cat)
      // Matched letters are highlighted; the query was matched against "Category: Title".
      const offset = cmd.category.length + 2
      for (let c = 0; c < cmd.title.length; c++) {
        const ch = cmd.title[c] ?? ''
        if (idx.includes(offset + c)) {
          const mk = document.createElement('mark')
          mk.textContent = ch
          left.append(mk)
        } else left.append(ch)
      }
      row.append(left)
      const shown = effectiveKeys(cmd)
      if (shown) {
        const keys = document.createElement('span')
        keys.className = 'keys'
        for (const k of shown.split('+')) {
          const kbd = document.createElement('kbd')
          kbd.textContent = k
          keys.append(kbd)
        }
        row.append(keys)
      }
      row.onclick = () => choose(i)
      row.onmouseenter = () => {
        if (selected !== i) {
          selected = i
          updateSelection()
        }
      }
      results.append(row)
    })
  }

  function updateSelection(): void {
    results.querySelectorAll('.result').forEach((el, i) => el.classList.toggle('sel', i === selected))
    results.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
    schedulePreview()
  }

  // Preview after a short pause so holding an arrow key doesn't re-theme the whole window per row.
  function schedulePreview(): void {
    window.clearTimeout(previewTimer)
    previewTimer = window.setTimeout(() => {
      const cmd = shown[selected]?.cmd
      if (previewed && previewed !== cmd) previewed.revert?.()
      previewed = null
      if (cmd?.preview) {
        cmd.preview()
        previewed = cmd
      }
    }, 70)
  }

  function close(): void {
    window.clearTimeout(previewTimer)
    previewed?.revert?.() // dismissed without choosing: put things back
    previewed = null
    overlay.hidden = true
  }

  function choose(i: number): void {
    const cmd = shown[i]?.cmd
    if (!cmd) return
    window.clearTimeout(previewTimer)
    previewed = null // the command itself commits the choice
    overlay.hidden = true
    recent.unshift(cmd.id)
    recent.splice(8)
    void Promise.resolve()
      .then(() => cmd.run())
      .catch((err: unknown) => deps.report(`${cmd.title}: ${err instanceof Error ? err.message : String(err)}`, true))
  }

  input.oninput = filter
  input.onkeydown = (e) => {
    if (e.key === 'Escape') close()
    else if (e.key === 'Enter') choose(selected)
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!shown.length) return
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length
      updateSelection()
    }
  }
  overlay.onmousedown = (e) => {
    if (e.target === overlay) close()
  }

  return {
    open(query = '') {
      overlay.hidden = false
      input.value = query
      input.focus()
      filter()
    },
    close,
    isOpen: () => !overlay.hidden
  }
}
