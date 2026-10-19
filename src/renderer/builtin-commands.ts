import { register } from './commands'
import { session } from './session'
import { flushSettings, settings } from './settings'
import { currentThemeId } from './appearance'
import { activeTheme, allThemes, applyTheme, findTheme } from './themes'

/** What the commands need from the rest of the app. main.ts supplies these. */
export interface BuiltinDeps {
  openFolder: () => Promise<void>
  saveActive: () => Promise<void>
  closeActiveTab: () => void
  openSearch: () => void
  showFind: () => void
  toggleSide: (side: 'project' | 'commit') => void
  toggleView: (view: 'output' | 'terminal' | 'run' | 'debug' | 'find' | 'problems' | 'structure') => void
  newTerminal: () => void
  toggleZen: () => void
  toggleFullscreen: () => Promise<void>
  openSettings: (category?: string) => void
  openSettingsFile: () => Promise<void>
  openThemesDir: () => Promise<void>
  openCustomCss: () => Promise<void>
  run: () => Promise<void>
  debug: () => Promise<void>
  stop: () => Promise<void>
  control: (cmd: 'resume' | 'stepOver' | 'stepInto' | 'stepOut') => Promise<void>
  toggleBreakpoint: () => void
  editRunConfigs: () => Promise<void>
  /** Runs a Monaco editor action by id (rename, reformat, find usages...). */
  editorAction: (id: string) => void
  git: (what: 'refresh' | 'pull' | 'push' | 'stash') => void
}

const ACCENTS: [string, string][] = [
  ['Teal', '#26c6b0'], ['Blue', '#4b8bf5'], ['Periwinkle', '#7aa2f7'], ['Violet', '#bd93f9'], ['Pink', '#ff79c6'], ['Red', '#ff5370'],
  ['Orange', '#ff9e64'], ['Amber', '#ffcb6b'], ['Lime', '#c3e88d'], ['Cyan', '#4dd0e1'], ['Rose', '#f78fb3'], ['Green', '#00e676']
]

export function registerBuiltinCommands(d: BuiltinDeps): void {
  const toggle = (category: string, title: string, key: string): void =>
    register({ id: `toggle.${key}`, category, title: `Toggle ${title}`, run: () => settings.set(key, !settings.get<boolean>(key)) })
  const choose = (category: string, key: string, value: string, title: string): void =>
    register({ id: `set.${key}.${value}`, category, title, run: () => settings.set(key, value) })
  const stepNumber = (category: string, title: string, key: string, delta: number, min: number, max: number): void =>
    register({
      id: `step.${key}.${delta}`,
      category,
      title,
      run: () => settings.set(key, Math.min(max, Math.max(min, +(settings.get<number>(key) + delta).toFixed(2))))
    })

  // ---- File ----
  register({ id: 'file.open', category: 'File', title: 'Open Folder…', keys: 'Ctrl+O', run: d.openFolder })
  register({ id: 'file.save', category: 'File', title: 'Save', keys: 'Ctrl+S', run: d.saveActive })
  register({ id: 'file.close', category: 'File', title: 'Close Tab', keys: 'Ctrl+W', run: d.closeActiveTab })
  register({ id: 'nav.search', category: 'Navigate', title: 'Search Everywhere', keys: 'Shift+Shift', run: d.openSearch })
  register({ id: 'nav.find', category: 'Navigate', title: 'Find in Project', keys: 'Ctrl+Shift+F', run: d.showFind })

  // ---- View ----
  register({ id: 'view.project', category: 'View', title: 'Toggle Project Window', keys: 'Alt+1', run: () => d.toggleSide('project') })
  register({ id: 'view.commit', category: 'View', title: 'Toggle Commit Window', keys: 'Alt+0', run: () => d.toggleSide('commit') })
  register({ id: 'view.output', category: 'View', title: 'Toggle Output', keys: 'Alt+2', run: () => d.toggleView('output') })
  register({ id: 'view.terminal', category: 'View', title: 'Toggle Terminal', keys: 'Alt+3', run: () => d.toggleView('terminal') })
  register({ id: 'view.problems', category: 'View', title: 'Toggle Problems', keys: 'Alt+6', run: () => d.toggleView('problems') })
  register({ id: 'view.structure', category: 'View', title: 'Toggle Structure', keys: 'Alt+7', run: () => d.toggleView('structure') })
  register({ id: 'view.run', category: 'View', title: 'Toggle Run Window', run: () => d.toggleView('run') })
  register({ id: 'view.debug', category: 'View', title: 'Toggle Debug Window', run: () => d.toggleView('debug') })
  register({ id: 'view.newTerminal', category: 'View', title: 'New Terminal', keys: 'Ctrl+Shift+`', run: d.newTerminal })
  register({ id: 'view.zen', category: 'View', title: 'Toggle Zen Mode', keys: 'Ctrl+Alt+Z', run: d.toggleZen })
  register({ id: 'view.fullscreen', category: 'View', title: 'Toggle Full Screen', keys: 'F11', run: d.toggleFullscreen })
  stepNumber('View', 'Zoom In', 'zoom', 10, 60, 220)
  stepNumber('View', 'Zoom Out', 'zoom', -10, 60, 220)
  register({ id: 'view.zoomReset', category: 'View', title: 'Reset Zoom', run: () => settings.reset('zoom') })

  // ---- Settings ----
  register({ id: 'settings.open', category: 'Settings', title: 'Open Settings', keys: 'Ctrl+,', run: () => d.openSettings() })
  register({ id: 'settings.file', category: 'Settings', title: 'Open settings.json', run: d.openSettingsFile })
  register({ id: 'settings.css', category: 'Settings', title: 'Open custom.css', run: d.openCustomCss })
  register({ id: 'settings.themes', category: 'Settings', title: 'Open Themes Folder', run: d.openThemesDir })
  register({ id: 'settings.extensions', category: 'Settings', title: 'Manage Extensions', run: () => d.openSettings('Extensions') })
  register({ id: 'window.reload', category: 'Settings', title: 'Reload Window', run: async () => {
      await Promise.all([flushSettings(), session.flush()]) // don't lose what's about to be saved
      location.reload()
    } })
  register({ id: 'settings.keymap', category: 'Settings', title: 'Show Keyboard Shortcuts', run: () => d.openSettings('Keymap') })
  register({ id: 'settings.reset', category: 'Settings', title: 'Reset All Settings', run: () => settings.resetAll() })

  // ---- Appearance: themes (each previews live as you move through the list) ----
  const currentOptions = (): { accent?: string; glass: boolean } => ({ accent: settings.get<string>('accent') || undefined, glass: settings.get<boolean>('glass') })
  for (const p of allThemes()) {
    register({
      id: `theme.${p.id}`,
      category: 'Theme',
      title: p.name,
      run: () => {
        settings.set('autoTheme', false)
        settings.set('theme', p.id)
      },
      preview: () => void applyTheme(p, activeTheme().options, true),
      revert: () => void applyTheme(findTheme(currentThemeId()), currentOptions(), true)
    })
  }
  for (const [name, hex] of ACCENTS) {
    register({
      id: `accent.${hex}`,
      category: 'Accent',
      title: name,
      run: () => settings.set('accent', hex),
      preview: () => void applyTheme(activeTheme().palette, { ...currentOptions(), accent: hex }, false),
      revert: () => void applyTheme(activeTheme().palette, currentOptions(), false)
    })
  }
  register({ id: 'accent.default', category: 'Accent', title: 'Use the theme’s own accent', run: () => settings.set('accent', '') })
  toggle('Appearance', 'Rainbow Accent', 'accentCycle')
  toggle('Appearance', 'Colorful Interface', 'colorful')
  toggle('Appearance', 'Glass Panels', 'glass')
  toggle('Appearance', 'Status Bar', 'showStatusBar')
  toggle('Appearance', 'Tool Window Buttons', 'showStripe')
  toggle('Appearance', 'Select Open File in Project Tree', 'treeFollow')
  choose('Background', 'background', 'aurora', 'Animated Aurora')
  choose('Background', 'background', 'gradient', 'Soft Gradient')
  choose('Background', 'background', 'solid', 'Solid Color')
  choose('Animations', 'animations', 'full', 'Full')
  choose('Animations', 'animations', 'reduced', 'Reduced')
  choose('Animations', 'animations', 'off', 'Off')
  stepNumber('Animations', 'Faster', 'animSpeed', -0.25, 0.25, 3)
  stepNumber('Animations', 'Slower', 'animSpeed', 0.25, 0.25, 3)
  choose('Density', 'density', 'compact', 'Compact')
  choose('Density', 'density', 'comfortable', 'Comfortable')
  choose('Density', 'density', 'spacious', 'Spacious')
  stepNumber('Layout', 'Rounder Corners', 'radius', 2, 0, 28)
  stepNumber('Layout', 'Sharper Corners', 'radius', -2, 0, 28)
  stepNumber('Layout', 'More Space Between Panels', 'gap', 2, 0, 20)
  stepNumber('Layout', 'Less Space Between Panels', 'gap', -2, 0, 20)

  // ---- Editor ----
  stepNumber('Editor', 'Increase Font Size', 'fontSize', 1, 8, 40)
  stepNumber('Editor', 'Decrease Font Size', 'fontSize', -1, 8, 40)
  register({ id: 'editor.fontReset', category: 'Editor', title: 'Reset Font Size', run: () => settings.reset('fontSize') })
  toggle('Editor', 'Minimap', 'minimap')
  toggle('Editor', 'Rainbow Brackets', 'bracketColors')
  toggle('Editor', 'Indent Guides', 'indentGuides')
  toggle('Editor', 'Font Ligatures', 'fontLigatures')
  toggle('Editor', 'Sticky Scroll', 'stickyScroll')
  toggle('Editor', 'Breadcrumbs', 'breadcrumbs')
  toggle('Editor', 'Format on Save', 'formatOnSave')
  register({
    id: 'editor.wrap',
    category: 'Editor',
    title: 'Toggle Word Wrap',
    run: () => settings.set('wordWrap', settings.get<string>('wordWrap') === 'off' ? 'on' : 'off')
  })
  register({
    id: 'editor.lineNumbers',
    category: 'Editor',
    title: 'Cycle Line Numbers (on / relative / off)',
    run: () => {
      const order = ['on', 'relative', 'off']
      settings.set('lineNumbers', order[(order.indexOf(settings.get<string>('lineNumbers')) + 1) % order.length] as string)
    }
  })
  register({
    id: 'editor.whitespace',
    category: 'Editor',
    title: 'Toggle Show Whitespace',
    run: () => settings.set('renderWhitespace', settings.get<string>('renderWhitespace') === 'none' ? 'all' : 'none')
  })
  choose('Auto Save', 'autoSave', 'off', 'Off')
  choose('Auto Save', 'autoSave', 'afterDelay', 'After a Pause in Typing')
  choose('Auto Save', 'autoSave', 'onBlur', 'When the Window Loses Focus')
  register({ id: 'editor.format', category: 'Code', title: 'Reformat Code', keys: 'Ctrl+Alt+L', run: () => d.editorAction('forge.reformat') })
  register({ id: 'editor.rename', category: 'Code', title: 'Rename Symbol', keys: 'F2', run: () => d.editorAction('forge.rename') })
  register({ id: 'editor.usages', category: 'Code', title: 'Find Usages', keys: 'Alt+F7', run: () => d.editorAction('forge.findUsages') })
  register({ id: 'editor.quickfix', category: 'Code', title: 'Show Quick Fixes', keys: 'Ctrl+.', run: () => d.editorAction('editor.action.quickFix') })
  register({ id: 'editor.definition', category: 'Code', title: 'Go to Definition', keys: 'F12', run: () => d.editorAction('editor.action.revealDefinition') })

  // ---- Run / debug ----
  register({ id: 'run.run', category: 'Run', title: 'Run', keys: 'Shift+F10', run: d.run })
  register({ id: 'run.debug', category: 'Run', title: 'Debug', keys: 'Shift+F9', run: d.debug })
  register({ id: 'run.stop', category: 'Run', title: 'Stop', keys: 'Ctrl+F2', run: d.stop })
  register({ id: 'run.edit', category: 'Run', title: 'Edit Configurations…', run: d.editRunConfigs })
  register({ id: 'debug.resume', category: 'Debug', title: 'Resume', keys: 'F9', run: () => d.control('resume') })
  register({ id: 'debug.over', category: 'Debug', title: 'Step Over', keys: 'F8', run: () => d.control('stepOver') })
  register({ id: 'debug.into', category: 'Debug', title: 'Step Into', keys: 'F7', run: () => d.control('stepInto') })
  register({ id: 'debug.out', category: 'Debug', title: 'Step Out', keys: 'Shift+F8', run: () => d.control('stepOut') })
  register({ id: 'debug.breakpoint', category: 'Debug', title: 'Toggle Breakpoint', keys: 'Ctrl+F8', run: d.toggleBreakpoint })

  // ---- Git ----
  register({ id: 'git.refresh', category: 'Git', title: 'Refresh Status', run: () => d.git('refresh') })
  register({ id: 'git.pull', category: 'Git', title: 'Pull', run: () => d.git('pull') })
  register({ id: 'git.push', category: 'Git', title: 'Push', run: () => d.git('push') })
  register({ id: 'git.stash', category: 'Git', title: 'Stash…', run: () => d.git('stash') })
}
