import type { ExtensionInfo } from '../main/extensions'
import { register, unregister } from './commands'
import { toast, type ToastKind } from './effects'
import { settings } from './settings'

// The extension host. Extensions are ES modules exporting `activate(forge)`. They are OFF until the user turns
// them on in Settings → Extensions, because they run with the same power as Forge itself.

export interface EditorApi {
  getText: () => string | null
  getSelectedText: () => string
  replaceSelection: (text: string) => void
  insertText: (text: string) => void
  getFilePath: () => string | null
  getLanguage: () => string | null
  root: () => string | null
}

export type ExtensionEvent = 'open' | 'save'

/** What an extension receives in activate(). Version 1. */
export interface ForgeApi {
  version: 1
  commands: {
    register: (c: { id: string; title: string; category?: string; keys?: string; run: () => void | Promise<void> }) => void
  }
  ui: {
    toast: (message: string, kind?: ToastKind) => void
    statusItem: (opts: { text: string; tooltip?: string; onClick?: () => void }) => { update: (text: string) => void; dispose: () => void }
  }
  editor: EditorApi
  workspace: { root: () => string | null }
  settings: { get: (key: string) => unknown }
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
}

let deps: Deps | null = null
let states: ExtensionState[] = []
const cleanups = new Map<string, (() => void)[]>()
const listeners = new Map<ExtensionEvent, Set<{ ext: string; cb: (p: { path: string }) => void }>>()
const changeListeners = new Set<() => void>()

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const enabledMap = (): Record<string, boolean> => settings.getJson<Record<string, boolean>>('extensions', {})

function makeApi(info: ExtensionInfo, cleanup: (() => void)[]): ForgeApi {
  if (!deps) throw new Error('Extension host is not initialised')
  const d = deps
  return {
    version: 1,
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
      }
    },
    editor: d.editor,
    workspace: { root: d.editor.root },
    settings: { get: (key) => settings.get(key) },
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
    // The forge-ext:// scheme serves only this extension's folder (see main/extensions.ts).
    const mod = (await import(/* @vite-ignore */ `forge-ext://${state.info.id}/${state.info.main}`)) as { activate?: (api: ForgeApi) => unknown }
    if (typeof mod.activate !== 'function') throw new Error(`${state.info.main} must export a function named "activate"`)
    await mod.activate(makeApi(state.info, cleanup))
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
