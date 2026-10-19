import DOMPurify from 'dompurify'
import type { ExtensionInfo, Permission } from '../main/extensions'
import { ask, type ChatMessage } from './ai'
import { register, unregister } from './commands'
import type { ToolWindowDef, ToolWindows } from './docks'
import { toast, type ToastKind } from './effects'
import { askText } from './menu'
import { settings } from './settings'

// The extension host. Extensions are ES modules exporting `activate(forge)`. They are OFF until the user turns
// them on in Settings → Extensions, because they run with the same power as Forge itself. API version 2 adds panels,
// storage, more events and three permission-gated abilities (network, ai, files); everything from version 1 still works.

export interface EditorApi {
  getText: () => string | null
  getSelectedText: () => string
  replaceSelection: (text: string) => void
  insertText: (text: string) => void
  getFilePath: () => string | null
  getLanguage: () => string | null
  root: () => string | null
}

export type ExtensionEvent = 'open' | 'save' | 'activate' | 'close' | 'change'

export interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface FetchResult {
  status: number
  ok: boolean
  statusText: string
  headers: Record<string, string>
  text: string
  json: () => unknown
}

export interface PanelOptions {
  /** Unique within the extension. */
  id: string
  title: string
  /** SVG markup for the stripe button (sanitized); a puzzle piece by default. */
  icon?: string
  dock?: 'left' | 'right' | 'bottom'
  /** Called once with the panel's element: build the panel's UI in it. May return a function that cleans up. */
  render: (root: HTMLElement) => void | (() => void)
}

/** What an extension receives in activate(). */
export interface ForgeApi {
  /** 2. Version 1 extensions keep working: everything they used is still here. */
  version: 2
  commands: {
    register: (c: { id: string; title: string; category?: string; keys?: string; run: () => void | Promise<void> }) => void
  }
  ui: {
    toast: (message: string, kind?: ToastKind) => void
    statusItem: (opts: { text: string; tooltip?: string; onClick?: () => void }) => { update: (text: string) => void; dispose: () => void }
    /** Adds a tool window with its own button on a stripe. It is removed when the extension is switched off. */
    panel: (opts: PanelOptions) => { show: () => void; dispose: () => void }
    /** Asks the user for a line of text; resolves to null if they cancel. */
    input: (opts: { title: string; value?: string }) => Promise<string | null>
  }
  editor: EditorApi
  workspace: {
    root: () => string | null
    /** Reads a file inside the project folder. Needs the "files" permission. */
    readFile: (path: string) => Promise<string>
    /** Paths (relative to the project, with "/") of the project's files. Needs the "files" permission. */
    listFiles: () => Promise<string[]>
  }
  settings: { get: (key: string) => unknown }
  /** Remembered between sessions, private to the extension. Values must be JSON-serializable. */
  storage: {
    get: <T = unknown>(key: string, fallback?: T) => T | undefined
    set: (key: string, value: unknown) => void
    delete: (key: string) => void
  }
  net: {
    /** An HTTP(S) request made by Forge (no browser restrictions). Needs the "network" permission. */
    fetch: (url: string, init?: FetchInit) => Promise<FetchResult>
  }
  ai: {
    /** Asks the AI server the user configured (Settings → AI). Needs the "ai" permission. */
    complete: (prompt: string | ChatMessage[], opts?: { maxTokens?: number }) => Promise<string>
  }
  on: (event: ExtensionEvent, cb: (payload: { path: string }) => void) => () => void
}

export interface ExtensionState {
  info: ExtensionInfo
  status: 'disabled' | 'active' | 'error'
  error?: string
}

interface Deps {
  editor: EditorApi
  report: (msg: string, isError?: boolean) => void
  /** The dock manager, for panels. */
  panels: Pick<ToolWindows, 'register' | 'unregister' | 'show'>
}

let deps: Deps | null = null
let states: ExtensionState[] = []
const cleanups = new Map<string, (() => void)[]>()
const listeners = new Map<ExtensionEvent, Set<{ ext: string; cb: (p: { path: string }) => void }>>()
const changeListeners = new Set<() => void>()

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const enabledMap = (): Record<string, boolean> => settings.getJson<Record<string, boolean>>('extensions', {})

const DEFAULT_ICON =
  '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.5h4V4a1.5 1.5 0 003 0v4.5h-1.5a1.5 1.5 0 000 3H13v2H3V9.7a1.5 1.5 0 000-3z"/></svg>'

/** The ability needs a permission the extension did not ask for in its extension.json: say exactly what to add. */
function need(info: ExtensionInfo, permission: Permission, what: string): void {
  if (!info.permissions.includes(permission)) {
    throw new Error(`${what} needs the "${permission}" permission: add "permissions": ["${permission}"] to ${info.name}'s extension.json`)
  }
}

/** `p` (absolute or relative to `root`) as an absolute path, or an error if it leaves the project folder. */
export function resolveInside(root: string, p: string): string {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const isAbsolute = /^([a-zA-Z]:)?[\\/]/.test(p)
  const full = (isAbsolute ? p : `${base}/${p}`).replace(/\\/g, '/')
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  const joined = (full.startsWith('/') ? '/' : '') + parts.join('/')
  const lower = joined.toLowerCase()
  const lowerBase = base.toLowerCase()
  if (lower !== lowerBase && !lower.startsWith(lowerBase + '/')) throw new Error(`"${p}" is outside the project folder`)
  return joined
}

const jsonable = (value: unknown): string => {
  const text = JSON.stringify(value)
  if (text === undefined) throw new TypeError('storage.set needs a JSON-serializable value (not undefined, a function or a symbol)')
  return text
}

function makeApi(info: ExtensionInfo, cleanup: (() => void)[], data: Record<string, unknown>): ForgeApi {
  if (!deps) throw new Error('Extension host is not initialised')
  const d = deps

  // storage: kept in memory, written a moment after the last change, and written at once when the extension is turned off.
  let saveTimer: number | undefined
  const save = (): void => {
    window.clearTimeout(saveTimer)
    saveTimer = undefined
    window.forge.extensionDataSave(info.id, JSON.stringify(data)).catch((err: unknown) => d.report(`Extension "${info.name}" could not save its data: ${message(err)}`, true))
  }
  cleanup.push(() => {
    if (saveTimer !== undefined) save()
  })
  const scheduleSave = (): void => {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(save, 250)
  }

  const root = (): string | null => d.editor.root()
  const needRoot = (): string => {
    const r = root()
    if (!r) throw new Error('Open a project folder first')
    return r
  }

  return {
    version: 2,
    commands: {
      register(c) {
        if (typeof c?.id !== 'string' || typeof c.title !== 'string' || typeof c.run !== 'function') {
          throw new Error('commands.register needs { id: string, title: string, run: function }')
        }
        const id = `ext.${info.id}.${c.id}`
        register({ id, title: c.title, category: c.category ?? info.name, keys: c.keys, run: c.run })
        cleanup.push(() => unregister(id))
      }
    },
    ui: {
      toast: (m, kind = 'info') => toast(String(m), kind),
      statusItem(opts) {
        const el = document.createElement('span')
        el.className = 'sw ext-item'
        el.textContent = opts.text
        if (opts.tooltip) el.title = opts.tooltip
        if (opts.onClick) {
          const click = opts.onClick
          el.onclick = () => {
            try {
              click()
            } catch (err) {
              d.report(`Extension "${info.name}": ${message(err)}`, true)
            }
          }
        }
        document.getElementById('st-pos')?.before(el)
        const dispose = (): void => el.remove()
        cleanup.push(dispose)
        return { update: (text) => void (el.textContent = text), dispose }
      },
      panel(opts) {
        if (typeof opts?.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(opts.id) || typeof opts.title !== 'string' || typeof opts.render !== 'function') {
          throw new Error('ui.panel needs { id: letters/digits/"-", title: string, render: function }')
        }
        const id = `ext.${info.id}.${opts.id}`
        const rootEl = document.createElement('div')
        rootEl.className = 'view ext-panel'
        rootEl.hidden = true
        const def: ToolWindowDef = {
          id,
          title: opts.title,
          icon: opts.icon ? DOMPurify.sanitize(opts.icon, { USE_PROFILES: { svg: true, svgFilters: true } }) : DEFAULT_ICON,
          root: rootEl,
          dock: opts.dock ?? 'right'
        }
        d.panels.register(def)
        let dispose: (() => void) | undefined
        try {
          const result = opts.render(rootEl)
          if (typeof result === 'function') dispose = result
        } catch (err) {
          d.panels.unregister(id) // a panel whose render failed must not stay behind as an empty window
          throw err
        }
        let gone = false
        const remove = (): void => {
          if (gone) return
          gone = true
          try {
            dispose?.()
          } catch (err) {
            d.report(`Extension "${info.name}": ${message(err)}`, true)
          }
          d.panels.unregister(id)
        }
        cleanup.push(remove)
        return { show: () => d.panels.show(id), dispose: remove }
      },
      input: (opts) => askText(opts.title, opts.value ?? '')
    },
    editor: d.editor,
    workspace: {
      root,
      async readFile(path) {
        need(info, 'files', 'workspace.readFile')
        return window.forge.readFile(resolveInside(needRoot(), path))
      },
      async listFiles() {
        need(info, 'files', 'workspace.listFiles')
        const r = needRoot()
        const base = r.replace(/\\/g, '/').replace(/\/+$/, '')
        return (await window.forge.listFiles(r)).map((p) => p.replace(/\\/g, '/').slice(base.length + 1))
      }
    },
    settings: { get: (key) => settings.get(key) },
    storage: {
      get: <T,>(key: string, fallback?: T): T | undefined => (key in data ? (data[key] as T) : fallback),
      set(key, value) {
        data[key] = JSON.parse(jsonable(value)) // a copy, so later changes to the caller's object do not leak in unsaved
        scheduleSave()
      },
      delete(key) {
        delete data[key]
        scheduleSave()
      }
    },
    net: {
      async fetch(url, init = {}) {
        need(info, 'network', 'net.fetch')
        const res = await window.forge.extensionFetch(info.id, { method: init.method ?? 'GET', url, headers: init.headers ?? {}, body: init.body })
        return {
          status: res.status,
          ok: res.status >= 200 && res.status < 300,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers),
          text: res.body,
          json: () => JSON.parse(res.body) as unknown
        }
      }
    },
    ai: {
      async complete(prompt, opts = {}) {
        need(info, 'ai', 'ai.complete')
        const messages: ChatMessage[] = typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt
        if (!Array.isArray(messages) || !messages.length) throw new Error('ai.complete needs a prompt string or a non-empty list of { role, content }')
        return ask(messages, { maxTokens: opts.maxTokens })
      }
    },
    on(event, cb) {
      const entry = { ext: info.name, cb }
      let set = listeners.get(event)
      if (!set) listeners.set(event, (set = new Set()))
      set.add(entry)
      const off = (): void => void set.delete(entry)
      cleanup.push(off)
      return off
    }
  }
}

async function activate(state: ExtensionState): Promise<void> {
  const cleanup: (() => void)[] = []
  try {
    const data = await window.forge.extensionDataLoad(state.info.id)
    // The forge-ext:// scheme serves only this extension's folder (see main/extensions.ts).
    const mod = (await import(/* @vite-ignore */ `forge-ext://${state.info.id}/${state.info.main}`)) as { activate?: (api: ForgeApi) => unknown }
    if (typeof mod.activate !== 'function') throw new Error(`${state.info.main} must export a function named "activate"`)
    await mod.activate(makeApi(state.info, cleanup, data))
    cleanups.set(state.info.id, cleanup)
    state.status = 'active'
    state.error = undefined
  } catch (err) {
    for (const undo of cleanup) undo() // a half-activated extension must not leave pieces behind
    state.status = 'error'
    state.error = message(err)
    deps?.report(`Extension "${state.info.name}": ${state.error}`, true)
  }
  for (const fn of changeListeners) fn()
}

function deactivate(state: ExtensionState): void {
  for (const undo of cleanups.get(state.info.id) ?? []) undo()
  cleanups.delete(state.info.id)
  state.status = 'disabled'
  state.error = undefined
  for (const fn of changeListeners) fn()
}

export const extensions = {
  list: (): ExtensionState[] => states,
  onChange(fn: () => void): () => void {
    changeListeners.add(fn)
    return () => changeListeners.delete(fn)
  },
  /** Turns an extension on or off right away. (Code it already ran stays loaded until the window reloads.) */
  async setEnabled(id: string, on: boolean): Promise<void> {
    const state = states.find((s) => s.info.id === id)
    if (!state) throw new Error(`Unknown extension: ${id}`)
    settings.setJson('extensions', { ...enabledMap(), [id]: on })
    if (on && state.status !== 'active' && !state.info.error) await activate(state)
    else if (!on && state.status === 'active') deactivate(state)
  },
  emit(event: ExtensionEvent, payload: { path: string }): void {
    for (const { ext, cb } of listeners.get(event) ?? []) {
      try {
        cb(payload)
      } catch (err) {
        deps?.report(`Extension "${ext}": ${message(err)}`, true)
      }
    }
  }
}

/** Finds installed extensions and starts the ones the user has enabled. */
export async function initExtensions(d: Deps): Promise<void> {
  deps = d
  const found = await window.forge.extensionsList()
  states = found.map((info) => ({ info, status: info.error ? 'error' : 'disabled', error: info.error }))
  const enabled = enabledMap()
  for (const s of states) {
    if (enabled[s.info.id] && !s.info.error) await activate(s)
  }
  for (const fn of changeListeners) fn()
}
