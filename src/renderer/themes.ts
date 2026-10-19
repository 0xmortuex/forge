import * as monaco from 'monaco-editor'
import { setTerminalTheme } from './terminal'

/**
 * A theme is one small palette. Everything else (interface variables, the editor's syntax colors, the
 * terminal's ANSI colors) is derived from it, so a new theme is ~25 hex colors.
 */
export interface Palette {
  id: string
  name: string
  kind: 'dark' | 'light'
  bg0: string // window background, darkest
  bg1: string
  island: string // panel surface
  island2: string // raised surface (menus, inputs)
  hover: string
  sel: string // selected row
  border: string
  text: string
  textHi: string
  textDim: string
  accent: string
  accent2: string // the other end of accent gradients
  err: string
  warn: string
  ok: string
  info: string
  keyword: string
  string: string
  number: string
  comment: string
  type: string
  func: string
  tag: string
  constant: string
  operator: string
}

export interface ThemeOptions {
  /** Replaces the theme's accent (and derives the gradient partner). */
  accent?: string
  /** Translucent editor/panels so the animated background shows through. */
  glass?: boolean
}

// ---------------------------------------------------------------- color math

const HEX = /^#[0-9a-f]{6}$/i
export const isHex = (s: unknown): s is string => typeof s === 'string' && HEX.test(s)

type RGB = [number, number, number]
const parse = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
const toHex = ([r, g, b]: RGB): string => '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')

/** `t` of the way from a to b. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t])
}
export function rgba(hex: string, a: number): string {
  const [r, g, b] = parse(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
/** #rrggbbaa, which Monaco understands. */
const hexA = (hex: string, a: number): string => hex + clamp(a * 255).toString(16).padStart(2, '0')

function luminance(hex: string): number {
  const lin = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = parse(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = parse(hex).map((v) => v / 255) as RGB
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255])
}
/** Rotates a color's hue (degrees), keeping saturation and lightness. */
export function shiftHue(hex: string, deg: number): string {
  const [h, s, l] = toHsl(hex)
  return fromHsl(((h + deg) % 360 + 360) % 360, s, l)
}

// ---------------------------------------------------------------- built-in themes

type Def = Omit<Palette, 'id' | 'name' | 'kind'>
const t = (id: string, name: string, kind: 'dark' | 'light', d: Def): Palette => ({ id, name, kind, ...d })

export const BUILTIN_THEMES: Palette[] = [
  t('oceanic', 'Material Oceanic', 'dark', {
    bg0: '#101d22', bg1: '#15272d', island: '#263238', island2: '#2c3b42', hover: '#33444c', sel: '#2f5560', border: '#1d2b31',
    text: '#b0bec5', textHi: '#eeffff', textDim: '#607d8b', accent: '#26c6b0', accent2: '#7ff5e2',
    err: '#f07178', warn: '#ffcb6b', ok: '#c3e88d', info: '#82aaff',
    keyword: '#c792ea', string: '#c3e88d', number: '#f78c6c', comment: '#546e7a', type: '#ffcb6b', func: '#82aaff', tag: '#f07178', constant: '#f78c6c', operator: '#89ddff'
  }),
  t('darcula', 'Darcula', 'dark', {
    bg0: '#1e1f22', bg1: '#25272a', island: '#2b2b2b', island2: '#3c3f41', hover: '#4b4d4f', sel: '#214283', border: '#1e1f22',
    text: '#a9b7c6', textHi: '#dfe1e5', textDim: '#7a7e85', accent: '#4b8bf5', accent2: '#8ab4ff',
    err: '#ff6b68', warn: '#ffc66d', ok: '#6a8759', info: '#6897bb',
    keyword: '#cc7832', string: '#6a8759', number: '#6897bb', comment: '#808080', type: '#a9b7c6', func: '#ffc66d', tag: '#e8bf6a', constant: '#9876aa', operator: '#a9b7c6'
  }),
  t('dracula', 'Dracula', 'dark', {
    bg0: '#1e1f29', bg1: '#21222c', island: '#282a36', island2: '#343746', hover: '#44475a', sel: '#424561', border: '#191a21',
    text: '#d6d6e0', textHi: '#f8f8f2', textDim: '#6272a4', accent: '#bd93f9', accent2: '#ff79c6',
    err: '#ff5555', warn: '#f1fa8c', ok: '#50fa7b', info: '#8be9fd',
    keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4', type: '#8be9fd', func: '#50fa7b', tag: '#ff79c6', constant: '#bd93f9', operator: '#ff79c6'
  }),
  t('nord', 'Nord', 'dark', {
    bg0: '#242933', bg1: '#2b303b', island: '#2e3440', island2: '#3b4252', hover: '#434c5e', sel: '#4c566a', border: '#272c36',
    text: '#d8dee9', textHi: '#eceff4', textDim: '#7b88a1', accent: '#88c0d0', accent2: '#81a1c1',
    err: '#bf616a', warn: '#ebcb8b', ok: '#a3be8c', info: '#81a1c1',
    keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', comment: '#616e88', type: '#8fbcbb', func: '#88c0d0', tag: '#81a1c1', constant: '#d08770', operator: '#81a1c1'
  }),
  t('tokyo', 'Tokyo Night', 'dark', {
    bg0: '#13141c', bg1: '#16161e', island: '#1a1b26', island2: '#24283b', hover: '#2f3549', sel: '#33467c', border: '#101014',
    text: '#a9b1d6', textHi: '#c0caf5', textDim: '#565f89', accent: '#7aa2f7', accent2: '#bb9af7',
    err: '#f7768e', warn: '#e0af68', ok: '#9ece6a', info: '#7dcfff',
    keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64', comment: '#565f89', type: '#2ac3de', func: '#7aa2f7', tag: '#f7768e', constant: '#ff9e64', operator: '#89ddff'
  }),
  t('monokai', 'Monokai Pro', 'dark', {
    bg0: '#19181a', bg1: '#221f22', island: '#2d2a2e', island2: '#37343a', hover: '#403e41', sel: '#5b595c', border: '#19181a',
    text: '#c1c0c0', textHi: '#fcfcfa', textDim: '#727072', accent: '#ffd866', accent2: '#fc9867',
    err: '#ff6188', warn: '#ffd866', ok: '#a9dc76', info: '#78dce8',
    keyword: '#ff6188', string: '#ffd866', number: '#ab9df2', comment: '#727072', type: '#78dce8', func: '#a9dc76', tag: '#ff6188', constant: '#ab9df2', operator: '#ff6188'
  }),
  t('solarized-dark', 'Solarized Dark', 'dark', {
    bg0: '#00212b', bg1: '#002b36', island: '#073642', island2: '#0d4150', hover: '#124957', sel: '#1b5a69', border: '#00232d',
    text: '#93a1a1', textHi: '#eee8d5', textDim: '#657b83', accent: '#2aa198', accent2: '#268bd2',
    err: '#dc322f', warn: '#b58900', ok: '#859900', info: '#268bd2',
    keyword: '#859900', string: '#2aa198', number: '#d33682', comment: '#586e75', type: '#b58900', func: '#268bd2', tag: '#268bd2', constant: '#cb4b16', operator: '#859900'
  }),
  t('gruvbox', 'Gruvbox Dark', 'dark', {
    bg0: '#1d2021', bg1: '#282828', island: '#32302f', island2: '#3c3836', hover: '#504945', sel: '#665c54', border: '#1d2021',
    text: '#ebdbb2', textHi: '#fbf1c7', textDim: '#928374', accent: '#fabd2f', accent2: '#fe8019',
    err: '#fb4934', warn: '#fabd2f', ok: '#b8bb26', info: '#83a598',
    keyword: '#fb4934', string: '#b8bb26', number: '#d3869b', comment: '#928374', type: '#fabd2f', func: '#b8bb26', tag: '#fb4934', constant: '#d3869b', operator: '#fe8019'
  }),
  t('catppuccin', 'Catppuccin Mocha', 'dark', {
    bg0: '#11111b', bg1: '#181825', island: '#1e1e2e', island2: '#313244', hover: '#3b3d52', sel: '#45475a', border: '#11111b',
    text: '#cdd6f4', textHi: '#f5f5ff', textDim: '#7f849c', accent: '#cba6f7', accent2: '#f5c2e7',
    err: '#f38ba8', warn: '#f9e2af', ok: '#a6e3a1', info: '#89b4fa',
    keyword: '#cba6f7', string: '#a6e3a1', number: '#fab387', comment: '#6c7086', type: '#f9e2af', func: '#89b4fa', tag: '#f38ba8', constant: '#fab387', operator: '#89dceb'
  }),
  t('rose-pine', 'Rosé Pine', 'dark', {
    bg0: '#16141f', bg1: '#191724', island: '#1f1d2e', island2: '#26233a', hover: '#302d41', sel: '#403d52', border: '#14121c',
    text: '#e0def4', textHi: '#fffaf3', textDim: '#6e6a86', accent: '#ebbcba', accent2: '#c4a7e7',
    err: '#eb6f92', warn: '#f6c177', ok: '#9ccfd8', info: '#7aa7c7',
    keyword: '#eb6f92', string: '#f6c177', number: '#ebbcba', comment: '#6e6a86', type: '#9ccfd8', func: '#c4a7e7', tag: '#eb6f92', constant: '#ebbcba', operator: '#908caa'
  }),
  t('one-dark', 'One Dark Pro', 'dark', {
    bg0: '#1b1f27', bg1: '#21252b', island: '#282c34', island2: '#2c313a', hover: '#3a3f4b', sel: '#3e4451', border: '#1b1d23',
    text: '#abb2bf', textHi: '#d7dae0', textDim: '#5c6370', accent: '#61afef', accent2: '#c678dd',
    err: '#e06c75', warn: '#e5c07b', ok: '#98c379', info: '#56b6c2',
    keyword: '#c678dd', string: '#98c379', number: '#d19a66', comment: '#5c6370', type: '#e5c07b', func: '#61afef', tag: '#e06c75', constant: '#d19a66', operator: '#56b6c2'
  }),
  t('github-dark', 'GitHub Dark', 'dark', {
    bg0: '#0d1117', bg1: '#11161d', island: '#161b22', island2: '#1c2128', hover: '#262c36', sel: '#1f3a5f', border: '#0d1117',
    text: '#c9d1d9', textHi: '#f0f6fc', textDim: '#8b949e', accent: '#58a6ff', accent2: '#a371f7',
    err: '#f85149', warn: '#d29922', ok: '#3fb950', info: '#58a6ff',
    keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', comment: '#8b949e', type: '#ffa657', func: '#d2a8ff', tag: '#7ee787', constant: '#79c0ff', operator: '#ff7b72'
  }),
  t('synthwave', "Synthwave '84", 'dark', {
    bg0: '#1a1033', bg1: '#211640', island: '#262335', island2: '#34294f', hover: '#3d3160', sel: '#4a3a7a', border: '#1a1033',
    text: '#c8b6e8', textHi: '#ffffff', textDim: '#848bbd', accent: '#ff7edb', accent2: '#36f9f6',
    err: '#fe4450', warn: '#fede5d', ok: '#72f1b8', info: '#36f9f6',
    keyword: '#fede5d', string: '#ff8b39', number: '#f97e72', comment: '#848bbd', type: '#36f9f6', func: '#36f9f6', tag: '#72f1b8', constant: '#f97e72', operator: '#fede5d'
  }),
  t('forge-light', 'Forge Light', 'light', {
    bg0: '#d9e3e8', bg1: '#e7eef2', island: '#ffffff', island2: '#f1f5f7', hover: '#e3eaee', sel: '#cdeae6', border: '#d3dde2',
    text: '#3a4a52', textHi: '#11242c', textDim: '#7a8d96', accent: '#00a896', accent2: '#2ad4b3',
    err: '#d6455d', warn: '#b57b00', ok: '#2e9d57', info: '#2f6fed',
    keyword: '#8a3fbf', string: '#2f8f4e', number: '#d4600f', comment: '#8a9ba3', type: '#a56d00', func: '#2f6fed', tag: '#d6455d', constant: '#d4600f', operator: '#1c7c87'
  }),
  t('solarized-light', 'Solarized Light', 'light', {
    bg0: '#eee8d5', bg1: '#f5efdc', island: '#fdf6e3', island2: '#f2ecd9', hover: '#e8e1cb', sel: '#cfe0d7', border: '#e0d9c2',
    text: '#586e75', textHi: '#073642', textDim: '#93a1a1', accent: '#2aa198', accent2: '#268bd2',
    err: '#dc322f', warn: '#b58900', ok: '#859900', info: '#268bd2',
    keyword: '#859900', string: '#2aa198', number: '#d33682', comment: '#93a1a1', type: '#b58900', func: '#268bd2', tag: '#268bd2', constant: '#cb4b16', operator: '#859900'
  }),
  t('github-light', 'GitHub Light', 'light', {
    bg0: '#e1e4e8', bg1: '#eaeef2', island: '#ffffff', island2: '#f6f8fa', hover: '#eaeef2', sel: '#ddf4ff', border: '#d0d7de',
    text: '#424a53', textHi: '#1f2328', textDim: '#6e7781', accent: '#0969da', accent2: '#8250df',
    err: '#cf222e', warn: '#9a6700', ok: '#1a7f37', info: '#0969da',
    keyword: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#6e7781', type: '#953800', func: '#8250df', tag: '#116329', constant: '#0550ae', operator: '#cf222e'
  }),
  t('high-contrast', 'High Contrast', 'dark', {
    bg0: '#000000', bg1: '#000000', island: '#0a0a0a', island2: '#1a1a1a', hover: '#2a2a2a', sel: '#003366', border: '#555555',
    text: '#ffffff', textHi: '#ffffff', textDim: '#bfbfbf', accent: '#00e5ff', accent2: '#ffea00',
    err: '#ff5252', warn: '#ffd740', ok: '#69f0ae', info: '#40c4ff',
    keyword: '#ff7ad9', string: '#98ffa2', number: '#ffb86c', comment: '#9aa0a6', type: '#00e5ff', func: '#ffea00', tag: '#ff5252', constant: '#ff9e80', operator: '#ffffff'
  })
]

export const DEFAULT_THEME = 'oceanic'

// ---------------------------------------------------------------- custom themes (JSON files)

const REQUIRED_KEYS = Object.keys(BUILTIN_THEMES[0] as Palette).filter((k) => !['id', 'name', 'kind'].includes(k)) as (keyof Def)[]

let custom: Palette[] = []

export function allThemes(): Palette[] {
  return [...BUILTIN_THEMES, ...custom]
}
export function findTheme(id: string): Palette {
  return allThemes().find((p) => p.id === id) ?? (BUILTIN_THEMES[0] as Palette)
}

/**
 * Turns user theme files into palettes. A file is either a full palette or `{ "extends": "dracula",
 * "colors": { "accent": "#ff0080" } }`. Invalid files are skipped, and each gets a readable reason.
 */
export function loadCustomThemes(files: { name: string; text: string }[]): string[] {
  const problems: string[] = []
  const loaded: Palette[] = []
  for (const file of files) {
    try {
      const raw = JSON.parse(file.text) as Record<string, unknown>
      const base = raw['extends'] !== undefined ? BUILTIN_THEMES.find((p) => p.id === raw['extends']) : undefined
      if (raw['extends'] !== undefined && !base) throw new Error(`unknown base theme "${String(raw['extends'])}"`)
      const colors = { ...(base ?? {}), ...((raw['colors'] as object | undefined) ?? raw) } as Record<string, unknown>
      for (const key of REQUIRED_KEYS) {
        if (!isHex(colors[key])) throw new Error(`"${key}" must be a #rrggbb color${colors[key] === undefined ? ' (missing)' : ''}`)
      }
      const id = String(raw['id'] ?? file.name.replace(/\.json$/i, '')).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
      if (BUILTIN_THEMES.some((p) => p.id === id)) throw new Error(`id "${id}" is taken by a built-in theme`)
      const kind = raw['kind'] === 'light' || raw['kind'] === 'dark' ? raw['kind'] : (base?.kind ?? 'dark')
      loaded.push({ ...(colors as unknown as Def), id, name: String(raw['name'] ?? id), kind })
    } catch (err) {
      problems.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  custom = loaded
  return problems
}

// ---------------------------------------------------------------- derivation

function accentPair(p: Palette, o: ThemeOptions): [string, string] {
  if (!o.accent || !isHex(o.accent)) return [p.accent, p.accent2]
  // A custom accent needs a gradient partner: nudge the hue and brighten a little.
  return [o.accent, mix(shiftHue(o.accent, 32), p.kind === 'dark' ? '#ffffff' : '#000000', p.kind === 'dark' ? 0.18 : 0.08)]
}

export function cssVars(p: Palette, o: ThemeOptions = {}): Record<string, string> {
  const dark = p.kind === 'dark'
  const [a, a2] = accentPair(p, o)
  const inkDark = '#0b1a1f'
  const ink = (luminance(a) + luminance(a2)) / 2 > 0.3 ? inkDark : '#ffffff'
  return {
    '--bg-0': p.bg0, '--bg-1': p.bg1, '--island': p.island, '--island-2': p.island2, '--hover': p.hover, '--sel': p.sel,
    '--border': p.border, '--outline': mix(p.border, p.textDim, dark ? 0.4 : 0.3),
    '--text': p.text, '--text-hi': p.textHi, '--text-dim': p.textDim,
    '--accent': a, '--accent-2': a2, '--accent-soft': rgba(a, dark ? 0.16 : 0.14), '--accent-ink': ink,
    '--err': p.err, '--warn': p.warn, '--ok': p.ok, '--info': p.info,
    '--syn-keyword': p.keyword, '--syn-string': p.string, '--syn-number': p.number, '--syn-func': p.func,
    '--syn-type': p.type, '--syn-tag': p.tag, '--syn-const': p.constant, '--syn-comment': p.comment,
    '--folder': mix(a, p.text, 0.35),
    '--scrim': dark ? rgba(mix(p.bg0, '#000000', 0.45), 0.6) : 'rgba(16, 32, 39, 0.28)',
    '--ring': dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.07)',
    '--shadow': dark ? '0 6px 18px rgba(0, 0, 0, 0.25)' : '0 4px 14px rgba(20, 40, 50, 0.12)',
    '--shadow-pop': dark ? '0 20px 60px rgba(0, 0, 0, 0.55)' : '0 18px 50px rgba(20, 40, 50, 0.25)',
    '--scroll': rgba(p.textDim, 0.3), '--scroll-hover': rgba(p.textDim, 0.6),
    '--aurora-1': rgba(a, dark ? 0.38 : 0.2), '--aurora-2': rgba(p.keyword, dark ? 0.3 : 0.16), '--aurora-3': rgba(p.info, dark ? 0.28 : 0.16)
  }
}

export function monacoTheme(p: Palette, o: ThemeOptions = {}): monaco.editor.IStandaloneThemeData {
  const dark = p.kind === 'dark'
  const [a] = accentPair(p, o)
  const bg = o.glass ? '#00000000' : p.island
  const c = (hex: string): string => hex.slice(1)
  const rainbow = [p.keyword, p.func, p.string, p.number, p.type, p.tag]
  return {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: c(p.comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: c(p.keyword) },
      { token: 'keyword.control', foreground: c(p.keyword) },
      { token: 'string', foreground: c(p.string) },
      { token: 'string.escape', foreground: c(p.operator) },
      { token: 'number', foreground: c(p.number) },
      { token: 'regexp', foreground: c(p.operator) },
      { token: 'type', foreground: c(p.type) },
      { token: 'type.identifier', foreground: c(p.type) },
      { token: 'identifier', foreground: c(p.textHi) },
      { token: 'delimiter', foreground: c(p.operator) },
      { token: 'operator', foreground: c(p.operator) },
      { token: 'tag', foreground: c(p.tag) },
      { token: 'attribute.name', foreground: c(p.type) },
      { token: 'attribute.value', foreground: c(p.string) },
      { token: 'predefined', foreground: c(p.func) },
      { token: 'constant', foreground: c(p.constant) }
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': mix(p.text, p.textHi, 0.35),
      'editorLineNumber.foreground': mix(p.textDim, p.island, 0.35),
      'editorLineNumber.activeForeground': mix(p.textDim, p.textHi, 0.5),
      'editor.lineHighlightBackground': mix(p.island, p.island2, 0.75),
      'editor.lineHighlightBorder': mix(p.island, p.island2, 0.75),
      'editor.selectionBackground': hexA(a, 0.32),
      'editor.inactiveSelectionBackground': hexA(a, 0.18),
      'editor.selectionHighlightBackground': hexA(a, 0.16),
      'editor.findMatchBackground': hexA(p.warn, 0.4),
      'editor.findMatchHighlightBackground': hexA(p.warn, 0.22),
      'editorCursor.foreground': a,
      'editorIndentGuide.background1': mix(p.island, p.textDim, 0.22),
      'editorIndentGuide.activeBackground1': mix(p.island, p.textDim, 0.55),
      'editorBracketHighlight.foreground1': rainbow[0] as string,
      'editorBracketHighlight.foreground2': rainbow[1] as string,
      'editorBracketHighlight.foreground3': rainbow[2] as string,
      'editorBracketHighlight.foreground4': rainbow[3] as string,
      'editorBracketHighlight.foreground5': rainbow[4] as string,
      'editorBracketHighlight.foreground6': rainbow[5] as string,
      'editorBracketHighlight.unexpectedBracket.foreground': p.err,
      'editorGutter.background': bg,
      'editorWidget.background': p.island2,
      'editorWidget.border': mix(p.border, p.textDim, 0.4),
      'editorSuggestWidget.background': p.island2,
      'editorSuggestWidget.selectedBackground': p.sel,
      'editorSuggestWidget.highlightForeground': a,
      'editorHoverWidget.background': p.island2,
      'editorHoverWidget.border': mix(p.border, p.textDim, 0.4),
      'editorError.foreground': p.err,
      'editorWarning.foreground': p.warn,
      'editorInfo.foreground': p.info,
      'scrollbarSlider.background': hexA(p.textDim, 0.27),
      'scrollbarSlider.hoverBackground': hexA(p.textDim, 0.5),
      'scrollbarSlider.activeBackground': hexA(p.textDim, 0.65),
      'diffEditor.insertedTextBackground': hexA(p.ok, 0.2),
      'diffEditor.removedTextBackground': hexA(p.err, 0.2),
      'diffEditor.insertedLineBackground': hexA(p.ok, 0.1),
      'diffEditor.removedLineBackground': hexA(p.err, 0.1),
      'minimap.background': bg,
      'input.background': p.island2,
      'dropdown.background': p.island2
    }
  }
}

export function terminalTheme(p: Palette, o: ThemeOptions = {}): Record<string, string> {
  const dark = p.kind === 'dark'
  const [a] = accentPair(p, o)
  const bright = (hex: string): string => mix(hex, dark ? '#ffffff' : '#000000', 0.2)
  return {
    background: p.island,
    foreground: mix(p.text, p.textHi, 0.3),
    cursor: a,
    cursorAccent: p.island,
    selectionBackground: rgba(a, 0.32),
    black: mix(p.island2, p.hover, 0.5),
    red: p.err, green: p.ok, yellow: p.warn, blue: p.func, magenta: p.keyword, cyan: p.operator, white: p.text,
    brightBlack: p.textDim, brightRed: bright(p.err), brightGreen: bright(p.ok), brightYellow: bright(p.warn),
    brightBlue: bright(p.func), brightMagenta: bright(p.keyword), brightCyan: bright(p.operator), brightWhite: p.textHi
  }
}

// ---------------------------------------------------------------- applying

let counter = 0
let current: { palette: Palette; options: ThemeOptions } = { palette: BUILTIN_THEMES[0] as Palette, options: {} }

export const activeTheme = (): { palette: Palette; options: ThemeOptions } => current

/**
 * Applies a theme everywhere: CSS variables, the Monaco editor, and every terminal.
 * Returns the Monaco theme name so the editor can be created with it.
 */
export function applyTheme(p: Palette, o: ThemeOptions = {}, animate = true): string {
  current = { palette: p, options: o }
  const root = document.documentElement
  if (animate) {
    // A short global transition makes the switch a crossfade; the class is removed once it has played.
    root.classList.add('theming')
    window.setTimeout(() => root.classList.remove('theming'), 520)
  }
  for (const [k, v] of Object.entries(cssVars(p, o))) root.style.setProperty(k, v)
  root.style.colorScheme = p.kind
  const name = `forge-${++counter}`
  monaco.editor.defineTheme(name, monacoTheme(p, o))
  monaco.editor.setTheme(name)
  setTerminalTheme(terminalTheme(p, o))
  // The OS-drawn window buttons sit over the top of the window, so match what is behind them.
  window.forge
    .setTitleBar(mix(p.bg1, p.bg0, 0.3), p.text)
    .catch((err: unknown) => console.error('Could not color the window buttons', err))
  return name
}
