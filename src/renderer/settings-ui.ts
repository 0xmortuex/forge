import { commands, customKeys, effectiveKeys } from './commands'
import { extensions } from './extensions'
import { keymap } from './keymap'
import { icons } from './icons'
import { CATEGORIES, DEFS, ensureSettingsFile, settings, userData, type SettingDef, type Value } from './settings'
import { allThemes, BUILTIN_THEMES, type Palette } from './themes'

export interface SettingsUiDeps {
  openFile: (path: string) => Promise<void>
  openCustomCss: () => Promise<void>
  report: (msg: string, isError?: boolean) => void
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

const PRESET_ACCENTS = [
  '#26c6b0', '#4b8bf5', '#7aa2f7', '#bd93f9', '#ff79c6', '#ff5370', '#ff9e64', '#ffcb6b', '#c3e88d', '#4dd0e1', '#f78fb3', '#00e676'
]

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

export function initSettingsUi(deps: SettingsUiDeps): { open: (category?: string) => void; close: () => void; isOpen: () => boolean } {
  const overlay = byId('settings')
  const nav = byId('settings-nav')
  const body = byId('settings-body')
  const search = byId<HTMLInputElement>('settings-search')
  const note = byId('settings-note')
  let category = 'Appearance'
  /** Re-reads one setting into its control (after a reset, or a change made elsewhere). */
  const syncs = new Map<string, () => void>()

  // ---------------- controls ----------------

  function control(def: SettingDef, rowEl: HTMLElement): HTMLElement {
    const c = def.control
    const sync = (): void => {
      rowEl.classList.toggle('changed', settings.isChanged(def.key))
    }
    const set = (v: Value): void => {
      settings.set(def.key, v)
      sync()
    }
    const wrap = el('div', 'ctl')

    if (c.type === 'bool') {
      const sw = el('button', 'switch')
      sw.setAttribute('role', 'switch')
      const paint = (): void => {
        const on = settings.get<boolean>(def.key)
        sw.classList.toggle('on', on)
        sw.setAttribute('aria-checked', String(on))
      }
      sw.onclick = () => {
        set(!settings.get<boolean>(def.key))
        paint()
      }
      syncs.set(def.key, () => {
        paint()
        sync()
      })
      paint()
      wrap.append(sw)
    } else if (c.type === 'select') {
      const sel = el('select', 'field sel-input')
      for (const o of c.options) {
        const opt = el('option', '', o.label)
        opt.value = o.value
        sel.append(opt)
      }
      sel.onchange = () => set(sel.value)
      syncs.set(def.key, () => {
        sel.value = settings.get<string>(def.key)
        sync()
      })
      sel.value = settings.get<string>(def.key)
      wrap.append(sel)
    } else if (c.type === 'number') {
      const range = el('input')
      range.type = 'range'
      range.min = String(c.min)
      range.max = String(c.max)
      range.step = String(c.step)
      const num = el('input', 'field num')
      num.type = 'number'
      num.min = String(c.min)
      num.max = String(c.max)
      num.step = String(c.step)
      const fmt = (v: number): string => (c.step < 1 ? v.toFixed(2).replace(/\.?0+$/, '') : String(v))
      const paint = (): void => {
        const v = settings.get<number>(def.key)
        range.value = String(v)
        num.value = fmt(v)
      }
      range.oninput = () => {
        set(Number(range.value))
        num.value = fmt(Number(range.value))
      }
      num.onchange = () => {
        const v = Number(num.value)
        if (Number.isFinite(v)) set(Math.min(c.max, Math.max(c.min, v)))
        paint()
      }
      syncs.set(def.key, () => {
        paint()
        sync()
      })
      paint()
      wrap.append(range, num)
      if (c.unit) wrap.append(el('span', 'desc', c.unit))
    } else if (c.type === 'text') {
      const input = el('input', 'field text-field')
      input.spellcheck = false
      input.value = settings.get<string>(def.key)
      if (c.placeholder) input.placeholder = c.placeholder
      if (c.list) {
        const dl = el('datalist')
        dl.id = `dl-${def.key}`
        for (const f of c.list) dl.append(new Option(f))
        input.setAttribute('list', dl.id)
        wrap.append(dl)
      }
      input.onchange = () => set(input.value.trim() === '' ? String(def.default) : input.value.trim())
      syncs.set(def.key, () => {
        input.value = settings.get<string>(def.key)
        sync()
      })
      wrap.append(input)
    } else if (c.type === 'theme-select') {
      const sel = el('select', 'field sel-input')
      for (const kind of ['dark', 'light'] as const) {
        const group = el('optgroup')
        group.label = kind === 'dark' ? 'Dark themes' : 'Light themes'
        for (const p of allThemes().filter((x) => x.kind === kind)) {
          const opt = el('option', '', p.name)
          opt.value = p.id
          group.append(opt)
        }
        sel.append(group)
      }
      sel.onchange = () => set(sel.value)
      syncs.set(def.key, () => {
        sel.value = settings.get<string>(def.key)
        sync()
      })
      sel.value = settings.get<string>(def.key)
      wrap.append(sel)
    } else if (c.type === 'color') {
      const swatches = el('div', 'swatches')
      const picker = el('input')
      picker.type = 'color'
      const paint = (): void => {
        const v = settings.get<string>(def.key)
        picker.value = v || '#26c6b0'
        swatches.querySelectorAll<HTMLElement>('.swatch').forEach((s) => s.classList.toggle('on', s.dataset['color'] === v))
      }
      const auto = el('button', 'btn', 'Theme default')
      auto.onclick = () => {
        set('')
        paint()
      }
      for (const color of PRESET_ACCENTS) {
        const s = el('button', 'swatch')
        s.style.setProperty('--c', color)
        s.dataset['color'] = color
        s.title = color
        s.onclick = () => {
          set(color)
          paint()
        }
        swatches.append(s)
      }
      picker.oninput = () => {
        set(picker.value)
        paint()
      }
      syncs.set(def.key, () => {
        paint()
        sync()
      })
      paint()
      wrap.append(swatches, picker, auto)
    }

    const reset = el('button', 'reset')
    reset.innerHTML = icons.refresh
    reset.title = 'Reset to default'
    reset.onclick = () => {
      settings.reset(def.key)
      syncs.get(def.key)?.()
    }
    wrap.append(reset)
    sync()
    return wrap
  }

  function row(def: SettingDef, i: number): HTMLElement {
    const r = el('div', 'srow')
    r.style.setProperty('--i', String(Math.min(i, 14)))
    const info = el('div', 'info')
    info.append(el('div', 'label', def.label))
    if (def.description) info.append(el('div', 'desc', def.description))
    r.append(info, control(def, r))
    return r
  }

  // ---------------- the theme gallery ----------------

  function gallery(def: SettingDef): HTMLElement {
    const grid = el('div', 'theme-grid')
    const cards = new Map<string, HTMLElement>()
    allThemes().forEach((p: Palette, i) => {
      const card = el('button', 'theme-card')
      card.style.setProperty('--i', String(i))
      const mock = el('div', 'mock')
      mock.style.background = p.bg0
      const side = el('div', 'side')
      side.style.background = p.island2
      for (const color of [p.accent, p.keyword, p.func]) {
        const bar = el('i')
        bar.style.background = color
        bar.style.width = '70%'
        side.append(bar)
      }
      const code = el('div', 'code')
      code.style.background = p.island
      for (const [color, w] of [[p.keyword, 55], [p.string, 78], [p.func, 40], [p.number, 62], [p.comment, 48]] as [string, number][]) {
        const line = el('i')
        line.style.background = color
        line.style.width = `${w}%`
        code.append(line)
      }
      mock.append(side, code)
      card.append(mock, el('div', 'nm', p.name), el('div', 'kd', `${p.kind === 'light' ? 'Light' : 'Dark'}${BUILTIN(p) ? '' : ' · custom'}`))
      card.onclick = () => {
        settings.set('autoTheme', false) // choosing a theme yourself means you want that one
        settings.set(def.key, p.id)
        paint()
        syncs.get(def.key)?.()
        syncs.get('autoTheme')?.()
      }
      cards.set(p.id, card)
      grid.append(card)
    })
    const paint = (): void => cards.forEach((card, id) => card.classList.toggle('on', id === settings.get<string>(def.key)))
    syncs.set(def.key, paint)
    paint()
    return grid
  }
  const BUILTIN = (p: Palette): boolean => BUILTIN_THEMES.some((b) => b.id === p.id)

  // ---------------- pages ----------------

  function group(title: string, defs: SettingDef[], start: number): HTMLElement {
    const g = el('div', 'sgroup')
    g.append(el('h3', '', title))
    defs.forEach((d, i) => {
      if (d.control.type === 'theme') {
        g.append(gallery(d))
        const tools = el('div', 'srow')
        const info = el('div', 'info')
        info.append(el('div', 'label', 'Custom themes'), el('div', 'desc', 'Put a .json file in the themes folder, e.g. { "extends": "dracula", "colors": { "accent": "#ff0080" } }'))
        const open = el('button', 'btn', 'Open themes folder')
        open.onclick = () => {
          window.forge.openThemesDir().catch((err: unknown) => deps.report(String(err instanceof Error ? err.message : err), true))
        }
        tools.append(info, open)
        g.append(tools)
        const css = el('div', 'srow')
        const cssInfo = el('div', 'info')
        cssInfo.append(el('div', 'label', 'Custom CSS'), el('div', 'desc', 'Restyle anything with your own custom.css. It applies when you save it in Forge.'))
        const openCss = el('button', 'btn', 'Open custom.css')
        openCss.onclick = () => {
          deps.openCustomCss().then(() => close()).catch((err: unknown) => deps.report(err instanceof Error ? err.message : String(err), true))
        }
        css.append(cssInfo, openCss)
        g.append(css)
      } else g.append(row(d, start + i))
    })
    return g
  }

  function problems(): void {
    if (!settings.problems.length) return
    const box = el('div', 'sgroup')
    box.append(el('h3', '', 'Problems'))
    for (const p of settings.problems) {
      const r = el('div', 'srow')
      r.style.color = 'var(--err)'
      r.textContent = p
      box.append(r)
    }
    body.append(box)
  }

  /** Every command, with its shortcut. "Set" records a new one; a custom shortcut is added to the default. */
  function keymapPage(): void {
    const g = el('div', 'sgroup')
    g.append(el('h3', '', 'Keyboard shortcuts'))
    const q = search.value.trim().toLowerCase()
    const table = el('table', 'keytable')
    for (const c of commands().filter((x) => !q || `${x.category} ${x.title}`.toLowerCase().includes(q))) {
      const tr = el('tr')
      tr.dataset['id'] = c.id
      tr.append(el('td', '', `${c.category}: ${c.title}`))
      const keysCell = el('td', 'keys-cell')
      const paint = (): void => {
        keysCell.replaceChildren()
        const shown = effectiveKeys(c)
        if (c.keys) for (const k of c.keys.split('+')) keysCell.append(el('kbd', '', k))
        const mine = customKeys.get(c.id)
        if (mine) {
          keysCell.append(el('span', 'desc', ' + '))
          for (const k of mine.split('+')) keysCell.append(el('kbd', 'custom', k))
        } else if (!shown) keysCell.append(el('span', 'desc', '—'))
      }
      paint()
      const actions = el('td', 'key-actions')
      const set = el('button', 'btn', 'Set')
      set.onclick = () => {
        set.textContent = 'Press keys… (Esc cancels)'
        keymap
          .record(c.id)
          .then((combo) => {
            if (combo) keymap.set(c.id, combo)
          })
          .catch((err: unknown) => deps.report(err instanceof Error ? err.message : String(err), true))
          .finally(() => {
            set.textContent = 'Set'
            paint()
            clear.hidden = !customKeys.has(c.id)
          })
      }
      const clear = el('button', 'btn', 'Remove')
      clear.hidden = !customKeys.has(c.id)
      clear.onclick = () => {
        keymap.set(c.id, null)
        paint()
        clear.hidden = true
      }
      actions.append(set, clear)
      tr.append(keysCell, actions)
      table.append(tr)
    }
    const reset = el('button', 'btn', 'Remove all custom shortcuts')
    reset.onclick = () => {
      keymap.resetAll()
      render()
    }
    g.append(table, el('div', 'desc', 'A shortcut you set is added to the default one. Open the Command Palette (Ctrl+Shift+P) to find any action.'), reset)
    body.append(g)
  }

  /** Installed extensions, each with an on/off switch. They are off until the user turns them on. */
  function extensionsPage(): void {
    const g = el('div', 'sgroup')
    g.append(el('h3', '', 'Extensions'))
    const warn = el('div', 'srow')
    warn.style.color = 'var(--warn)'
    warn.textContent =
      'Extensions run with the same access as Forge itself (your files, terminals and git). Only turn on extensions you trust.'
    g.append(warn)
    const list = extensions.list()
    if (!list.length) g.append(el('div', 'hint', 'No extensions installed. Put an extension folder in the extensions folder (button below), then reopen this page.'))
    list.forEach((ext, i) => {
      const r = el('div', 'srow')
      r.style.setProperty('--i', String(Math.min(i, 14)))
      const info = el('div', 'info')
      info.append(el('div', 'label', `${ext.info.name}${ext.info.version ? ' ' + ext.info.version : ''}`))
      if (ext.info.description) info.append(el('div', 'desc', ext.info.description))
      const status = el('div', 'desc', ext.status === 'active' ? 'Active' : ext.status === 'error' ? `Problem: ${ext.error ?? 'unknown'}` : 'Off')
      if (ext.status === 'error') status.style.color = 'var(--err)'
      if (ext.status === 'active') status.style.color = 'var(--ok)'
      info.append(status)
      const sw = el('button', 'switch')
      sw.setAttribute('role', 'switch')
      sw.dataset['ext'] = ext.info.id
      sw.classList.toggle('on', ext.status === 'active')
      sw.disabled = Boolean(ext.info.error)
      sw.onclick = () => {
        extensions.setEnabled(ext.info.id, ext.status !== 'active').catch((err: unknown) => deps.report(err instanceof Error ? err.message : String(err), true))
      }
      const ctl = el('div', 'ctl')
      ctl.append(sw)
      r.append(info, ctl)
      g.append(r)
    })
    const tools = el('div', 'srow')
    const open = el('button', 'btn', 'Open extensions folder')
    open.onclick = () => {
      window.forge.openExtensionsDir().catch((err: unknown) => deps.report(err instanceof Error ? err.message : String(err), true))
    }
    tools.append(el('div', 'desc', 'An extension is a folder with an extension.json and an ES module that exports activate(forge).'), open)
    g.append(tools)
    body.append(g)
  }

  function about(): void {
    const box = el('div', 'about')
    box.append(el('div', 'big', 'Forge'))
    for (const line of [
      'A JetBrains-style IDE built with Electron, TypeScript and Monaco.',
      `${allThemes().length} themes · ${commands().length} commands · ${DEFS.length} settings`,
      `Settings: ${userData.settingsPath}`,
      `User data folder: ${userData.dir}`
    ]) box.append(el('div', '', line))
    body.append(box)
  }

  function render(): void {
    syncs.clear()
    body.replaceChildren()
    body.scrollTop = 0
    problems()
    const q = search.value.trim().toLowerCase()
    nav.querySelectorAll('.snav').forEach((n) => n.classList.toggle('active', (!q || category === 'Keymap') && (n as HTMLElement).dataset['cat'] === category))
    if (q && category !== 'Keymap') {
      const hits = DEFS.filter((d) => `${d.label} ${d.description ?? ''} ${d.group} ${d.category} ${d.key}`.toLowerCase().includes(q))
      note.textContent = `${hits.length} setting${hits.length === 1 ? '' : 's'} match`
      for (const cat of CATEGORIES) {
        const inCat = hits.filter((d) => d.category === cat.id)
        if (inCat.length) body.append(group(cat.id, inCat, 0))
      }
      if (!hits.length) body.append(el('div', 'hint', 'No settings match your search'))
      return
    }
    note.textContent = ''
    if (category === 'Keymap') return keymapPage()
    if (category === 'Extensions') return extensionsPage()
    if (category === 'About') return about()
    const defs = DEFS.filter((d) => d.category === category)
    const groups = [...new Set(defs.map((d) => d.group))]
    let n = 0
    for (const g of groups) {
      const inGroup = defs.filter((d) => d.group === g)
      body.append(group(g, inGroup, n))
      n += inGroup.length
    }
  }

  function renderNav(): void {
    nav.replaceChildren()
    const h = el('h2')
    h.innerHTML = icons.gear
    h.append('Settings')
    nav.append(h)
    for (const c of CATEGORIES) {
      const b = el('button', 'snav')
      b.dataset['cat'] = c.id
      const dot = el('span', 'dotc')
      dot.style.setProperty('--c', c.color)
      b.append(dot, c.id)
      b.onclick = () => {
        category = c.id
        search.value = ''
        render()
      }
      nav.append(b)
    }
  }

  // ---------------- wiring ----------------

  search.oninput = render
  byId('settings-close').onclick = () => close()
  byId('settings-reset-all').onclick = () => {
    if (!confirm('Reset every setting to its default?')) return
    settings.resetAll()
    render()
  }
  byId('settings-open-file').onclick = () => {
    ensureSettingsFile()
      .then(() => deps.openFile(userData.settingsPath))
      .then(() => close())
      .catch((err: unknown) => deps.report(`Open settings.json: ${err instanceof Error ? err.message : String(err)}`, true))
  }
  overlay.onmousedown = (e) => {
    if (e.target === overlay) close()
  }
  overlay.onkeydown = (e) => {
    if (e.key === 'Escape') close()
  }
  // A change from elsewhere (command palette, shortcut) while the window is open.
  settings.onChange((key) => syncs.get(key)?.())
  // The Extensions page re-draws itself when an extension starts, stops or fails.
  extensions.onChange(() => {
    if (!overlay.hidden && category === 'Extensions' && !search.value.trim()) render()
  })

  function close(): void {
    overlay.hidden = true
  }

  renderNav()
  return {
    open(cat) {
      if (cat) category = cat
      search.value = ''
      renderNav()
      render()
      overlay.hidden = false
      search.focus()
    },
    close,
    isOpen: () => !overlay.hidden
  }
}
