import { KEYMAP_PRESETS } from './keymap-presets'

// Every user-changeable option is declared once here. The Settings window is generated from this list,
// settings.json stores only what differs from the defaults, and appearance.ts applies each value live.

export type Value = string | number | boolean

export type Control =
  | { type: 'bool' }
  | { type: 'select'; options: { value: string; label: string }[] }
  | { type: 'number'; min: number; max: number; step: number; unit?: string }
  | { type: 'text'; placeholder?: string; list?: string[] }
  | { type: 'color' }
  | { type: 'theme' } // the theme gallery
  | { type: 'theme-select' } // a dropdown of every theme

export interface SettingDef {
  key: string
  category: string
  group: string
  label: string
  description?: string
  default: Value
  control: Control
}

export const CATEGORIES = [
  { id: 'Appearance', color: 'var(--accent)' },
  { id: 'Editor', color: 'var(--info)' },
  { id: 'Terminal', color: 'var(--ok)' },
  { id: 'Behavior', color: 'var(--warn)' },
  { id: 'AI', color: 'var(--syn-string)' },
  { id: 'Keymap', color: 'var(--syn-keyword)' },
  { id: 'Extensions', color: 'var(--syn-func)' },
  { id: 'About', color: 'var(--err)' }
] as const

const opts = (...pairs: [string, string][]): { value: string; label: string }[] => pairs.map(([value, label]) => ({ value, label }))
const onOff = { type: 'bool' } as const
const FONTS = [
  'Segoe UI Variable', 'Inter Variable', 'Segoe UI', 'Calibri', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia',
  'Cascadia Code', 'Cascadia Mono', 'Consolas', 'JetBrains Mono', 'Fira Code', 'Courier New'
]

export const DEFAULT_EDITOR_FONT = '"JetBrains Mono", "Cascadia Code", Consolas, monospace'
export const DEFAULT_TERMINAL_FONT = '"Cascadia Mono", Consolas, monospace'

export const DEFS: SettingDef[] = [
  // ---- Appearance ----
  { key: 'theme', category: 'Appearance', group: 'Theme', label: 'Color theme', default: 'oceanic', control: { type: 'theme' },
    description: 'Drop your own theme files into the themes folder to add more.' },
  { key: 'autoTheme', category: 'Appearance', group: 'Theme', label: 'Follow the system light/dark setting', default: false, control: onOff,
    description: 'Switches between the two themes below when your operating system changes. Picking a theme yourself turns this off.' },
  { key: 'themeLight', category: 'Appearance', group: 'Theme', label: 'Theme for light mode', default: 'forge-light', control: { type: 'theme-select' } },
  { key: 'themeDark', category: 'Appearance', group: 'Theme', label: 'Theme for dark mode', default: 'oceanic', control: { type: 'theme-select' } },
  { key: 'accent', category: 'Appearance', group: 'Theme', label: 'Accent color', default: '', control: { type: 'color' },
    description: 'Overrides the theme’s accent. Clear it to use the theme’s own.' },
  { key: 'accentCycle', category: 'Appearance', group: 'Theme', label: 'Rainbow accent', default: false, control: onOff,
    description: 'Slowly cycles the accent color through the whole spectrum.' },
  { key: 'colorful', category: 'Appearance', group: 'Theme', label: 'Colorful interface', default: true, control: onOff,
    description: 'Gives each tool window its own color and tints tabs by file type.' },
  { key: 'glass', category: 'Appearance', group: 'Theme', label: 'Glass panels', default: false, control: onOff,
    description: 'Translucent panels and editor, so the animated background shows through.' },
  { key: 'customCss', category: 'Appearance', group: 'Theme', label: 'Apply custom.css', default: true, control: onOff,
    description: 'Your own styles from custom.css in the user-data folder. Turn off if a style breaks the layout.' },

  { key: 'background', category: 'Appearance', group: 'Background & motion', label: 'Window background', default: 'aurora',
    control: { type: 'select', options: opts(['aurora', 'Animated aurora'], ['gradient', 'Soft gradient'], ['solid', 'Solid color']) } },
  { key: 'animations', category: 'Appearance', group: 'Background & motion', label: 'Animations', default: 'full',
    control: { type: 'select', options: opts(['full', 'Full'], ['reduced', 'Reduced (no looping effects)'], ['off', 'Off']) },
    description: 'Turn off if you prefer a perfectly still interface.' },
  { key: 'animSpeed', category: 'Appearance', group: 'Background & motion', label: 'Animation speed', default: 1,
    control: { type: 'number', min: 0.25, max: 3, step: 0.25, unit: '×' }, description: 'Lower is faster. Higher makes every transition longer.' },
  { key: 'notifications', category: 'Appearance', group: 'Background & motion', label: 'Notifications', default: 'important',
    control: { type: 'select', options: opts(['all', 'All messages'], ['important', 'Errors and results (save, commit…)'], ['errors', 'Errors only'], ['off', 'Off']) } },

  { key: 'radius', category: 'Appearance', group: 'Layout', label: 'Panel corner radius', default: 12, control: { type: 'number', min: 0, max: 28, step: 1, unit: 'px' } },
  { key: 'gap', category: 'Appearance', group: 'Layout', label: 'Space between panels', default: 8, control: { type: 'number', min: 0, max: 20, step: 1, unit: 'px' } },
  { key: 'density', category: 'Appearance', group: 'Layout', label: 'Density', default: 'comfortable',
    control: { type: 'select', options: opts(['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']) } },
  { key: 'uiFont', category: 'Appearance', group: 'Layout', label: 'Interface font', default: 'Segoe UI Variable', control: { type: 'text', list: FONTS, placeholder: 'Font name' } },
  { key: 'uiFontSize', category: 'Appearance', group: 'Layout', label: 'Interface font size', default: 13, control: { type: 'number', min: 10, max: 18, step: 1, unit: 'px' } },
  { key: 'zoom', category: 'Appearance', group: 'Layout', label: 'Interface zoom', default: 100, control: { type: 'number', min: 60, max: 220, step: 10, unit: '%' } },
  { key: 'showStatusBar', category: 'Appearance', group: 'Layout', label: 'Show status bar', default: true, control: onOff },
  { key: 'keymapPreset', category: 'Keymap', group: 'Preset', label: 'Keymap preset', default: 'forge',
    control: { type: 'select', options: opts(...KEYMAP_PRESETS) } },
  { key: 'showStripe', category: 'Appearance', group: 'Layout', label: 'Show tool window buttons', default: true, control: onOff },
  { key: 'treeShowHidden', category: 'Appearance', group: 'Layout', label: 'Show hidden files in the Project tree', default: true, control: onOff, description: 'Files and folders whose names start with a dot (.git, .env ...).' },
  { key: 'treeFollow', category: 'Appearance', group: 'Layout', label: 'Select the open file in the Project tree', default: false, control: onOff, description: 'Switching tabs expands the tree to that file.' },

  // ---- Editor ----
  { key: 'fontFamily', category: 'Editor', group: 'Font', label: 'Font family', default: DEFAULT_EDITOR_FONT,
    control: { type: 'text', list: ['JetBrains Mono', 'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Fira Code', 'Courier New'], placeholder: 'Font name or CSS list' },
    description: 'A single name is enough; fallbacks are added for you.' },
  { key: 'fontSize', category: 'Editor', group: 'Font', label: 'Font size', default: 13, control: { type: 'number', min: 8, max: 40, step: 1, unit: 'px' } },
  { key: 'lineHeight', category: 'Editor', group: 'Font', label: 'Line height', default: 21, control: { type: 'number', min: 12, max: 60, step: 1, unit: 'px' } },
  { key: 'fontLigatures', category: 'Editor', group: 'Font', label: 'Font ligatures', default: false, control: onOff, description: 'Joins symbols like => and !== (needs a font that has them, such as Fira Code).' },

  { key: 'minimap', category: 'Editor', group: 'Display', label: 'Minimap', default: false, control: onOff },
  { key: 'lineNumbers', category: 'Editor', group: 'Display', label: 'Line numbers', default: 'on',
    control: { type: 'select', options: opts(['on', 'On'], ['relative', 'Relative'], ['off', 'Off']) } },
  { key: 'renderWhitespace', category: 'Editor', group: 'Display', label: 'Show whitespace', default: 'none',
    control: { type: 'select', options: opts(['none', 'Never'], ['boundary', 'Between words'], ['selection', 'In selection'], ['all', 'Always']) } },
  { key: 'rulers', category: 'Editor', group: 'Display', label: 'Rulers', default: '', control: { type: 'text', placeholder: 'e.g. 80, 120' }, description: 'Vertical guide lines at these columns.' },
  { key: 'wordWrap', category: 'Editor', group: 'Display', label: 'Word wrap', default: 'off',
    control: { type: 'select', options: opts(['off', 'Off'], ['on', 'At the window edge'], ['bounded', 'At the window edge or 120']) } },
  { key: 'indentGuides', category: 'Editor', group: 'Display', label: 'Indent guides', default: true, control: onOff },
  { key: 'bracketColors', category: 'Editor', group: 'Display', label: 'Rainbow brackets', default: true, control: onOff, description: 'Colors matching bracket pairs by nesting depth.' },
  { key: 'stickyScroll', category: 'Editor', group: 'Display', label: 'Sticky scroll', default: true, control: onOff, description: 'Keeps the enclosing function or class pinned at the top.' },
  { key: 'gitPullMode', category: 'Editor', group: 'Git', label: 'Pull strategy', default: 'ff-only',
    description: 'How Pull brings in the remote commits. Fast-forward never creates a merge commit behind your back.',
    control: { type: 'select', options: opts(['ff-only', 'Fast-forward only'], ['merge', 'Merge'], ['rebase', 'Rebase']) } },
  { key: 'gitGutter', category: 'Editor', group: 'Display', label: 'Show git changes in the gutter', default: true, control: onOff, description: 'Green, blue and red marks beside lines added, modified or removed since the last commit. Click one to roll it back.' },
  { key: 'breadcrumbs', category: 'Editor', group: 'Display', label: 'Breadcrumbs', default: true, control: onOff, description: 'The file path and the class or function around the cursor, above the editor.' },
  { key: 'inlayHints', category: 'Editor', group: 'Display', label: 'Inline hints', default: 'onUnlessPressed',
    description: 'Parameter names and inferred types shown inside the code, from the language server.',
    control: { type: 'select', options: opts(['on', 'Always'], ['onUnlessPressed', 'Always (hold Ctrl+Alt to hide)'], ['offUnlessPressed', 'Never (hold Ctrl+Alt to show)'], ['off', 'Never']) } },
  { key: 'postfix', category: 'Editor', group: 'Display', label: 'Postfix templates', default: true, control: onOff,
    description: 'Type value.log, items.for, user.if and similar, then accept the suggestion to rewrite the expression (JavaScript, TypeScript, Python, Java, Kotlin, C#, Go, Rust).' },
  { key: 'spellcheck', category: 'Editor', group: 'Display', label: 'Check spelling', default: true, control: onOff,
    description: 'Underlines misspelled words in comments, strings, Markdown and text files (English). Ctrl+. offers corrections.' },
  { key: 'emmet', category: 'Editor', group: 'Display', label: 'Emmet abbreviations', default: true, control: onOff,
    description: 'Type ul>li*3 or df in an HTML or CSS file and press Tab (or pick the suggestion) to expand it.' },
  { key: 'codeVision', category: 'Editor', group: 'Display', label: 'Show usages above declarations', default: true, control: onOff,
    description: 'A "3 references" label above functions, classes and methods (TypeScript/JavaScript); click it to list them.' },
  { key: 'aiBaseUrl', category: 'AI', group: 'Connection', label: 'Server URL', default: '',
    description: 'Any OpenAI-compatible server: https://api.openai.com/v1, https://api.anthropic.com/v1, http://localhost:11434/v1 (Ollama), and so on. Your code is sent here, so only use a server you trust.',
    control: { type: 'text', placeholder: 'https://api.openai.com/v1' } },
  { key: 'aiModel', category: 'AI', group: 'Connection', label: 'Model', default: '',
    description: 'The model name the server expects, for example gpt-4o-mini or claude-sonnet-5-5.', control: { type: 'text', placeholder: 'model name' } },
  { key: 'aiInline', category: 'AI', group: 'Inline completions', label: 'Suggest code as you type', default: false, control: onOff,
    description: 'Greyed-out suggestions that Tab accepts. Off by default: every pause in typing sends your surrounding code to the server and costs a request.' },
  { key: 'aiInlineModel', category: 'AI', group: 'Inline completions', label: 'Model for suggestions', default: '',
    description: 'Leave empty to use the model above. A small, fast model works best here.', control: { type: 'text', placeholder: 'same as above' } },
  { key: 'folding', category: 'Editor', group: 'Display', label: 'Code folding', default: true, control: onOff },
  { key: 'scrollBeyondLastLine', category: 'Editor', group: 'Display', label: 'Scroll past the last line', default: false, control: onOff },

  { key: 'cursorStyle', category: 'Editor', group: 'Cursor', label: 'Cursor style', default: 'line',
    control: { type: 'select', options: opts(['line', 'Line'], ['block', 'Block'], ['underline', 'Underline'], ['line-thin', 'Thin line'], ['block-outline', 'Outlined block'], ['underline-thin', 'Thin underline']) } },
  { key: 'cursorBlinking', category: 'Editor', group: 'Cursor', label: 'Cursor animation', default: 'smooth',
    control: { type: 'select', options: opts(['blink', 'Blink'], ['smooth', 'Smooth'], ['phase', 'Phase'], ['expand', 'Expand'], ['solid', 'Solid']) } },
  { key: 'smoothCaret', category: 'Editor', group: 'Cursor', label: 'Glide the cursor between positions', default: true, control: onOff },
  { key: 'smoothScrolling', category: 'Editor', group: 'Cursor', label: 'Smooth scrolling', default: true, control: onOff },

  { key: 'tabSize', category: 'Editor', group: 'Editing', label: 'Tab size', default: 4, control: { type: 'number', min: 1, max: 12, step: 1, unit: 'spaces' }, description: 'Used for files whose indentation Forge cannot detect.' },
  { key: 'insertSpaces', category: 'Editor', group: 'Editing', label: 'Indent with spaces', default: true, control: onOff },
  { key: 'mouseWheelZoom', category: 'Editor', group: 'Editing', label: 'Zoom with Ctrl + mouse wheel', default: false, control: onOff },
  { key: 'formatOnSave', category: 'Editor', group: 'Editing', label: 'Format on save', default: false, control: onOff, description: 'Runs the language server’s formatter when you save (when it has one).' },
  { key: 'autoSave', category: 'Editor', group: 'Editing', label: 'Auto save', default: 'off',
    control: { type: 'select', options: opts(['off', 'Off'], ['afterDelay', 'After a pause in typing'], ['onBlur', 'When the window loses focus']) } },
  { key: 'autoSaveDelay', category: 'Editor', group: 'Editing', label: 'Auto save delay', default: 1000, control: { type: 'number', min: 200, max: 10000, step: 100, unit: 'ms' } },

  // ---- Terminal ----
  { key: 'terminalShell', category: 'Terminal', group: 'Shell', label: 'Shell', default: 'default',
    description: 'What new terminals run. Takes effect for terminals opened from now on.',
    control: { type: 'select', options: opts(['default', 'System default'], ['powershell', 'Windows PowerShell'], ['pwsh', 'PowerShell 7 (pwsh)'], ['cmd', 'Command Prompt'], ['git-bash', 'Git Bash'], ['wsl', 'WSL']) } },
  { key: 'terminalFontFamily', category: 'Terminal', group: 'Font', label: 'Font family', default: DEFAULT_TERMINAL_FONT, control: { type: 'text', list: ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'JetBrains Mono', 'Fira Code', 'Courier New'], placeholder: 'Font name or CSS list' } },
  { key: 'terminalFontSize', category: 'Terminal', group: 'Font', label: 'Font size', default: 13, control: { type: 'number', min: 8, max: 32, step: 1, unit: 'px' } },
  { key: 'terminalLineHeight', category: 'Terminal', group: 'Font', label: 'Line height', default: 1, control: { type: 'number', min: 1, max: 2, step: 0.05, unit: '×' } },
  { key: 'terminalCursor', category: 'Terminal', group: 'Cursor', label: 'Cursor style', default: 'block',
    control: { type: 'select', options: opts(['block', 'Block'], ['bar', 'Bar'], ['underline', 'Underline']) } },
  { key: 'terminalBlink', category: 'Terminal', group: 'Cursor', label: 'Blinking cursor', default: true, control: onOff },
  { key: 'terminalScrollback', category: 'Terminal', group: 'Buffer', label: 'Scrollback lines', default: 5000, control: { type: 'number', min: 500, max: 100000, step: 500, unit: 'lines' } },

  // ---- Behavior ----
  { key: 'confirmDelete', category: 'Behavior', group: 'Files', label: 'Confirm before deleting files', default: true, control: onOff, description: 'Deleted files go to the Recycle Bin either way.' },
  { key: 'restoreSession', category: 'Behavior', group: 'Startup', label: 'Reopen the last project and tabs on startup', default: true, control: onOff },
  { key: 'gitRefreshOnFocus', category: 'Behavior', group: 'Git', label: 'Refresh git status when the window gains focus', default: true, control: onOff, description: 'Picks up changes made outside Forge.' }
]

const BY_KEY = new Map(DEFS.map((d) => [d.key, d]))
export const defOf = (key: string): SettingDef => {
  const d = BY_KEY.get(key)
  if (!d) throw new Error(`Unknown setting: ${key}`)
  return d
}

function validate(def: SettingDef, v: unknown): Value | undefined {
  const c = def.control
  if (c.type === 'bool') return typeof v === 'boolean' ? v : undefined
  if (c.type === 'number') return typeof v === 'number' && Number.isFinite(v) ? Math.min(c.max, Math.max(c.min, v)) : undefined
  if (c.type === 'select') return typeof v === 'string' && c.options.some((o) => o.value === v) ? v : undefined
  if (c.type === 'color') return typeof v === 'string' && (v === '' || /^#[0-9a-f]{6}$/i.test(v)) ? v : undefined
  return typeof v === 'string' ? v : undefined // text, theme, theme-select
}

type Listener = (key: string, value: Value) => void

export interface Store {
  get<T extends Value = Value>(key: string): T
  set(key: string, value: Value): void
  reset(key: string): void
  resetAll(): void
  isChanged(key: string): boolean
  /** Structured values that aren't individual settings (keybindings...). Kept in settings.json too. */
  getJson<T>(key: string, fallback: T): T
  setJson(key: string, value: unknown): void
  onChange(fn: Listener): () => void
  /** Problems found while reading settings.json (unknown type, out of range, ...). */
  problems: string[]
  /** Called when saving fails; the app wires this to its error reporting. */
  onSaveError: (err: Error) => void
}

// If the user-data folder can't be read at all, start with defaults and say why (the page must still render).
const data: Awaited<ReturnType<typeof window.forge.settingsLoad>> = await window.forge.settingsLoad().catch((err: unknown) => ({
  settings: {},
  state: {},
  themes: [],
  snippets: [],
  errors: [`Could not read your settings: ${err instanceof Error ? err.message : String(err)} — using defaults`],
  dir: '',
  settingsPath: '',
  customCss: '',
  customCssPath: ''
}))
export const userData = data

const overrides = new Map<string, Value>()
const extra: Record<string, unknown> = {} // keys we don't know about are preserved on save, never deleted
const problems: string[] = [...data.errors]
for (const [key, raw] of Object.entries(data.settings)) {
  const def = BY_KEY.get(key)
  if (!def) {
    extra[key] = raw
    continue
  }
  const v = validate(def, raw)
  if (v === undefined) problems.push(`settings.json: "${key}" has an invalid value (${JSON.stringify(raw)}), so the default is used`)
  else if (v !== def.default) overrides.set(key, v)
}

const listeners = new Set<Listener>()
let timer: number | undefined

export const settings: Store = {
  problems,
  onSaveError: (err) => console.error(err),
  get<T extends Value = Value>(key: string): T {
    return (overrides.get(key) ?? defOf(key).default) as T
  },
  set(key, value) {
    const def = defOf(key)
    const v = validate(def, value)
    if (v === undefined) throw new Error(`Invalid value for ${key}: ${JSON.stringify(value)}`)
    if (v === def.default) overrides.delete(key)
    else overrides.set(key, v)
    changed(key, v)
  },
  reset(key) {
    overrides.delete(key)
    changed(key, defOf(key).default)
  },
  resetAll() {
    const keys = [...overrides.keys()]
    overrides.clear()
    for (const k of keys) changed(k, defOf(k).default)
  },
  isChanged: (key) => overrides.has(key),
  getJson<T>(key: string, fallback: T): T {
    return key in extra ? (extra[key] as T) : fallback
  },
  setJson(key, value) {
    if (value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0)) delete extra[key]
    else extra[key] = value
    changed(key, JSON.stringify(value ?? null))
  },
  onChange(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
}

function changed(key: string, value: Value): void {
  for (const fn of listeners) fn(key, value)
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    const out = { ...extra, ...Object.fromEntries(overrides) }
    window.forge.settingsSave(JSON.stringify(out, null, 2)).catch((err: unknown) => settings.onSaveError(err as Error))
  }, 250)
}

/** Flushes any pending save now (used before the window closes). */
export function flushSettings(): Promise<void> {
  if (timer === undefined) return Promise.resolve()
  window.clearTimeout(timer)
  timer = undefined
  const out = { ...extra, ...Object.fromEntries(overrides) }
  return window.forge.settingsSave(JSON.stringify(out, null, 2))
}

/** Writes settings.json now (an empty object if nothing is customized), so it can be opened in the editor. */
export function ensureSettingsFile(): Promise<void> {
  window.clearTimeout(timer)
  timer = undefined
  return window.forge.settingsSave(JSON.stringify({ ...extra, ...Object.fromEntries(overrides) }, null, 2))
}
