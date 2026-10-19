import * as monaco from 'monaco-editor'
import { settings, userData } from './settings'
import { setTerminalSettings } from './terminal'
import { activeTheme, applyTheme, cssVars, findTheme, loadCustomThemes, shiftHue } from './themes'

// Turns settings into live changes. initAppearance() runs once at startup (before the editor exists);
// bindEditors() then lets editor settings reach the running editors; after that, every change applies instantly.

/** A bare font name gets sensible fallbacks; a full CSS font list is used as is. */
export const fontStack = (value: string, fallback: string): string =>
  value.includes(',') || value.includes('"') ? value : `"${value}", ${fallback}`

const str = (key: string): string => settings.get<string>(key)
const num = (key: string): number => settings.get<number>(key)
const bool = (key: string): boolean => settings.get<boolean>(key)

export function editorOptions(): monaco.editor.IStandaloneEditorConstructionOptions {
  const rulers = str('rulers')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => n > 0)
  const bracketColors = bool('bracketColors')
  return {
    fontFamily: fontStack(str('fontFamily'), 'Consolas, monospace'),
    fontSize: num('fontSize'),
    lineHeight: num('lineHeight'),
    fontLigatures: bool('fontLigatures'),
    minimap: { enabled: bool('minimap') },
    lineNumbers: (str('lineNumbers') as 'on' | 'off' | 'relative'),
    renderWhitespace: (str('renderWhitespace') as 'none' | 'boundary' | 'selection' | 'all'),
    rulers,
    wordWrap: (str('wordWrap') as 'off' | 'on' | 'bounded'),
    wordWrapColumn: 120,
    guides: { indentation: bool('indentGuides'), bracketPairs: bracketColors },
    bracketPairColorization: { enabled: bracketColors },
    stickyScroll: { enabled: bool('stickyScroll') },
    inlayHints: { enabled: str('inlayHints') as 'on' | 'off' | 'onUnlessPressed' | 'offUnlessPressed' },
    folding: bool('folding'),
    scrollBeyondLastLine: bool('scrollBeyondLastLine'),
    cursorStyle: (str('cursorStyle') as 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin'),
    cursorBlinking: (str('cursorBlinking') as 'blink' | 'smooth' | 'phase' | 'expand' | 'solid'),
    cursorSmoothCaretAnimation: bool('smoothCaret') ? 'on' : 'off',
    smoothScrolling: bool('smoothScrolling'),
    tabSize: num('tabSize'),
    insertSpaces: bool('insertSpaces'),
    mouseWheelZoom: bool('mouseWheelZoom')
  }
}

const EDITOR_KEYS = new Set([
  'fontFamily', 'fontSize', 'lineHeight', 'fontLigatures', 'minimap', 'lineNumbers', 'renderWhitespace', 'rulers', 'wordWrap',
  'indentGuides', 'bracketColors', 'stickyScroll', 'inlayHints', 'folding', 'scrollBeyondLastLine', 'cursorStyle', 'cursorBlinking',
  'smoothCaret', 'smoothScrolling', 'tabSize', 'insertSpaces', 'mouseWheelZoom'
])
const TERMINAL_KEYS = new Set(['terminalFontFamily', 'terminalFontSize', 'terminalLineHeight', 'terminalCursor', 'terminalBlink', 'terminalScrollback'])

const DENSITY: Record<string, Record<string, string>> = {
  compact: { '--row': '20px', '--row-lg': '22px', '--head': '30px', '--tab-pad': '3px' },
  comfortable: { '--row': '24px', '--row-lg': '26px', '--head': '34px', '--tab-pad': '5px' },
  spacious: { '--row': '28px', '--row-lg': '31px', '--head': '38px', '--tab-pad': '7px' }
}

const root = document.documentElement
const body = document.body

function themeOptions(): { accent?: string; glass: boolean } {
  return { accent: str('accent') || undefined, glass: bool('glass') }
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

/** The theme that should be showing right now: the chosen one, or the light/dark pair following the system. */
export function currentThemeId(): string {
  return bool('autoTheme') ? str(systemDark.matches ? 'themeDark' : 'themeLight') : str('theme')
}

function applyCurrentTheme(animate: boolean): string {
  return applyTheme(findTheme(currentThemeId()), themeOptions(), animate)
}

/** Your custom.css, as a <style> element that goes last so it can override anything. */
export function applyCustomCss(text: string): void {
  let style = document.getElementById('user-css') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'user-css'
    document.head.append(style)
  }
  style.textContent = bool('customCss') ? text : ''
}
let customCssText = userData.customCss
export function setCustomCss(text: string): void {
  customCssText = text
  applyCustomCss(text)
}

function applyBodyClasses(): void {
  const bg = str('background')
  body.classList.toggle('bg-gradient', bg === 'gradient')
  body.classList.toggle('bg-solid', bg === 'solid')
  body.classList.toggle('colorful', bool('colorful'))
  body.classList.toggle('glass', bool('glass'))
  body.classList.toggle('no-status', !bool('showStatusBar'))
  body.classList.toggle('no-stripe', !bool('showStripe'))
  body.classList.toggle('no-breadcrumbs', !bool('breadcrumbs'))
}

function applyLayout(): void {
  root.style.setProperty('--radius', `${num('radius')}px`)
  root.style.setProperty('--gap', `${num('gap')}px`)
  for (const [k, v] of Object.entries(DENSITY[str('density')] ?? DENSITY['comfortable'] ?? {})) root.style.setProperty(k, v)
  root.style.setProperty('--ui', fontStack(str('uiFont'), 'system-ui, sans-serif'))
  root.style.setProperty('--ui-size', `${num('uiFontSize')}px`)
}

function applyZoom(): void {
  window.forge.setZoom(num('zoom') / 100)
}

function applyMotion(): void {
  const mode = str('animations')
  const speed = num('animSpeed')
  root.style.setProperty('--speed', mode === 'off' ? '0' : String(mode === 'reduced' ? Math.min(speed, 1) * 0.5 : speed))
  body.classList.toggle('no-anim', mode === 'off')
  body.classList.toggle('reduced', mode === 'reduced')
  syncAccentCycle()
}

function applyTerminal(): void {
  setTerminalSettings({
    fontFamily: fontStack(str('terminalFontFamily'), 'Consolas, monospace'),
    fontSize: num('terminalFontSize'),
    lineHeight: num('terminalLineHeight'),
    cursorStyle: (str('terminalCursor') as 'block' | 'bar' | 'underline'),
    cursorBlink: bool('terminalBlink'),
    scrollback: num('terminalScrollback')
  })
}

// ---- Rainbow accent: re-colors only the accent variables, cheaply, a few times a second ----
const ACCENT_VARS = ['--accent', '--accent-2', '--accent-soft', '--accent-ink', '--aurora-1', '--folder']
let cycleFrame = 0
let cycling = false

function stopAccentCycle(): void {
  cancelAnimationFrame(cycleFrame)
  cycling = false
}

function syncAccentCycle(): void {
  const want = bool('accentCycle') && str('animations') === 'full'
  if (want === cycling) return
  if (!want) {
    stopAccentCycle()
    applyCurrentTheme(false) // restore the real accent
    return
  }
  cycling = true
  let last = 0
  const tick = (now: number): void => {
    if (now - last > 90) {
      last = now
      const { palette } = activeTheme()
      const base = str('accent') || palette.accent
      const vars = cssVars(palette, { accent: shiftHue(base, (now / 1000) * 8) })
      for (const k of ACCENT_VARS) root.style.setProperty(k, vars[k] as string)
    }
    cycleFrame = requestAnimationFrame(tick)
  }
  cycleFrame = requestAnimationFrame(tick)
}

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let diff: monaco.editor.IStandaloneDiffEditor | null = null

function applyEditor(key?: string): void {
  if (!editor || !diff) return
  const o = editorOptions()
  editor.updateOptions(o)
  diff.updateOptions(o as monaco.editor.IDiffEditorOptions)
  if (key === 'tabSize' || key === 'insertSpaces') {
    for (const m of monaco.editor.getModels()) m.updateOptions({ tabSize: num('tabSize'), insertSpaces: bool('insertSpaces') })
  }
}

/** Startup: apply everything except the editors, which don't exist yet. Returns the Monaco theme name. */
export function initAppearance(): string {
  settings.problems.push(...loadCustomThemes(userData.themes))
  applyBodyClasses()
  applyLayout()
  applyZoom()
  applyMotion()
  const themeName = applyCurrentTheme(false)
  applyCustomCss(customCssText)
  // Following the system: re-theme when the operating system switches between light and dark.
  systemDark.addEventListener('change', () => {
    if (bool('autoTheme')) applyCurrentTheme(true)
  })
  applyTerminal()

  settings.onChange((key) => {
    if (key === 'customCss') applyCustomCss(customCssText)
    else if (['theme', 'accent', 'glass', 'autoTheme', 'themeLight', 'themeDark'].includes(key)) {
      stopAccentCycle() // the new theme sets the real accent; the cycle restarts below if still wanted
      applyCurrentTheme(true)
      applyBodyClasses()
      syncAccentCycle()
    } else if (key === 'accentCycle' || key === 'animations' || key === 'animSpeed') applyMotion()
    else if (['background', 'colorful', 'showStatusBar', 'showStripe', 'breadcrumbs'].includes(key)) applyBodyClasses()
    else if (['radius', 'gap', 'density', 'uiFont', 'uiFontSize'].includes(key)) applyLayout()
    else if (key === 'zoom') applyZoom()
    else if (EDITOR_KEYS.has(key)) applyEditor(key)
    else if (TERMINAL_KEYS.has(key)) applyTerminal()
  })
  return themeName
}

/** Once the editors exist, setting changes can reach them. */
export function bindEditors(e: monaco.editor.IStandaloneCodeEditor, d: monaco.editor.IStandaloneDiffEditor): void {
  editor = e
  diff = d
  applyEditor()
}
