import { commandById, commands, customKeys, effectiveKeys } from './commands'
import { settings } from './settings'

// Custom shortcuts. A command's default shortcut keeps working; a custom one is an extra way to run it.
// Stored in settings.json as { "keybindings": { "<command id>": "Ctrl+Alt+M" } }.
//
// A keymap preset is a set of shortcuts that sits underneath the user's own: choosing "IntelliJ IDEA" makes Ctrl+D
// duplicate a line, Ctrl+Y delete one, Ctrl+W extend the selection and so on. The user's shortcuts win over the preset's,
// and only the user's are ever written to settings.json.

export const KEYMAP_PRESETS: [id: string, label: string][] = [
  ['forge', 'Forge (default)'],
  ['intellij', 'IntelliJ IDEA']
]

// Preset commands that work anywhere in the window. Every other preset shortcut works only while the editor has focus,
// so Ctrl+D is not stolen from a terminal (end of input) or Ctrl+Y from a text box (redo).
const GLOBAL_PRESET_COMMANDS = new Set(['file.close'])

// command id -> shortcut. These take over keys the editor or Forge would otherwise use (Ctrl+W closes a tab by default).
const PRESETS: Record<string, Record<string, string>> = {
  forge: {},
  intellij: {
    'code.duplicateLine': 'Ctrl+D',
    'code.deleteLine': 'Ctrl+Y',
    'code.extendSelection': 'Ctrl+W',
    'code.shrinkSelection': 'Ctrl+Shift+W',
    'file.close': 'Ctrl+F4',
    'code.selectNext': 'Alt+J',
    'code.unselectNext': 'Alt+Shift+J',
    'code.selectAllOccurrences': 'Ctrl+Alt+Shift+J',
    'code.moveLineUp': 'Alt+Shift+Up',
    'code.moveLineDown': 'Alt+Shift+Down',
    'code.replace': 'Ctrl+R',
    'code.commentBlock': 'Ctrl+Shift+/',
    'code.highlightUsages': 'Ctrl+Shift+F7'
  }
}

const KEY_NAMES: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Backslash: '\\', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
}
const IS_MAC = navigator.platform.startsWith('Mac')

/** "Ctrl+Shift+P"-style name for a key press, or null if only modifier keys are down. */
export function comboOf(e: KeyboardEvent): string | null {
  let key: string | undefined
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code
  else key = KEY_NAMES[e.code]
  if (!key) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push(IS_MAC ? 'Cmd' : 'Win')
  return [...mods, key].join('+')
}

// Bindings that mean something everywhere (clipboard, undo, find...). They can't be taken over.
const RESERVED = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+F', 'Ctrl+H', 'Ctrl+D', 'Ctrl+G', 'Ctrl+S', 'Ctrl+O', 'Ctrl+W'])

let recording = false
let report: (msg: string, isError?: boolean) => void = () => undefined

/** What the user chose themselves (the part that is saved). */
const userKeys = new Map<string, string>()

/** customKeys = the preset's shortcuts, with the user's own on top. */
function rebuild(): void {
  customKeys.clear()
  const preset = PRESETS[settings.get<string>('keymapPreset')] ?? {}
  for (const [id, combo] of Object.entries(preset)) if (commandById(id)) customKeys.set(id, combo)
  for (const [id, combo] of userKeys) customKeys.set(id, combo)
}

function load(): void {
  userKeys.clear()
  const stored = settings.getJson<Record<string, unknown>>('keybindings', {})
  for (const [id, combo] of Object.entries(stored)) {
    if (typeof combo === 'string' && commandById(id)) userKeys.set(id, combo)
  }
  rebuild()
}

function save(): void {
  settings.setJson('keybindings', Object.fromEntries(userKeys))
}

export const keymap = {
  /** Wires the global shortcut handler; call once the commands are registered. */
  init(reporter: (msg: string, isError?: boolean) => void): void {
    report = reporter
    load()
    window.addEventListener(
      'keydown',
      (e) => {
        if (recording) return
        const combo = comboOf(e)
        if (!combo) return
        const target = e.target as Element | null
        for (const [id, mine] of customKeys) {
          if (mine !== combo) continue
          if (!userKeys.has(id) && !GLOBAL_PRESET_COMMANDS.has(id) && !target?.closest?.('.monaco-editor')) continue // a preset's key, outside the editor
          e.preventDefault()
          e.stopPropagation()
          const cmd = commandById(id)
          void Promise.resolve()
            .then(() => cmd?.run())
            .catch((err: unknown) => report(`${cmd?.title ?? id}: ${err instanceof Error ? err.message : String(err)}`, true))
          return
        }
      },
      true // capture: before the editor, so a custom shortcut wins over editor keys
    )
  },

  /** Why `combo` can't be used for `forId`, or null if it can. */
  problem(combo: string, forId: string): string | null {
    if (!/\+/.test(combo) && !/^F\d/.test(combo)) return 'A shortcut needs a modifier key (Ctrl, Alt or Shift), or be a function key'
    if (RESERVED.has(combo)) return `${combo} is reserved for editing and can't be reassigned`
    for (const c of commands()) {
      if (c.id !== forId && effectiveKeys(c) === combo) return `${combo} is already used by "${c.category}: ${c.title}"`
    }
    return null
  },

  set(id: string, combo: string | null): void {
    if (combo === null) userKeys.delete(id)
    else userKeys.set(id, combo)
    save()
    rebuild()
  },

  resetAll(): void {
    userKeys.clear()
    save()
    rebuild()
  },

  /** Whether the user (not a preset) assigned this command's extra shortcut. */
  isUser: (id: string): boolean => userKeys.has(id),

  /** Switches preset; the user's own shortcuts stay. */
  setPreset(id: string): void {
    settings.set('keymapPreset', id)
    rebuild()
  },

  /**
   * Waits for the user to press a combination. Resolves with it, or null if they cancel with Escape.
   * Rejects (with a readable reason) if the combination can't be used.
   */
  record(forId: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      recording = true
      const finish = (): void => {
        recording = false
        window.removeEventListener('keydown', onKey, true)
      }
      const onKey = (e: KeyboardEvent): void => {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') {
          finish()
          return resolve(null)
        }
        const combo = comboOf(e)
        if (!combo) return // only a modifier so far; keep waiting for the real key
        finish()
        const why = keymap.problem(combo, forId)
        if (why) reject(new Error(why))
        else resolve(combo)
      }
      window.addEventListener('keydown', onKey, true)
    })
  }
}
