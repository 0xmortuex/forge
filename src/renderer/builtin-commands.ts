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
  openSearchScope: (scope: 'all' | 'files' | 'symbols' | 'actions', classesOnly?: boolean) => void
  showFind: () => void
  toggleSide: (side: 'project' | 'commit') => void
  toggleView: (view: 'output' | 'terminal' | 'run' | 'debug' | 'find' | 'problems' | 'structure' | 'bookmarks' | 'hierarchy' | 'git' | 'todo' | 'preview' | 'breakpoints' | 'http' | 'ai' | 'database' | 'duplicates' | 'npm' | 'tests' | 'viewer' | 'github' | 'docker') => void
  runAllTests: () => void
  findDuplicates: () => void
  addWordToDictionary: () => void
  runHttp: () => void
  nextTab: (delta: 1 | -1) => void
  aiAction: (action: 'explain' | 'fix' | 'tests' | 'document' | 'refactor') => void
  aiNewChat: () => void
  reopenClosedTab: () => void
  closeAllTabs: () => void
  closeOtherTabs: () => void
  saveAll: () => void
  reloadFromDisk: () => void
  renameCurrentFile: () => void
  newFile: () => void
  goToTest: () => void
  resetLayout: () => void
  saveLayoutAs: () => void
  chooseLayout: () => void
  deleteLayout: () => void
  inspectCode: () => void
  openInBrowser: () => void
  splitEditor: (how: 'right' | 'down' | 'none') => void
  runTests: () => void
  findReplace: () => void
  newTerminal: () => void
  splitTerminal: () => void
  toggleZen: () => void
  togglePresentation: () => void
  exportSettings: () => Promise<void>
  importSettings: () => Promise<void>
  toggleFullscreen: () => Promise<void>
  openSettings: (category?: string) => void
  openSettingsFile: () => Promise<void>
  openThemesDir: () => Promise<void>
  openSnippetsDir: () => Promise<void>
  surround: () => void
  newScratch: () => void
  showScratches: () => void
  compareWithFile: () => void
  compareWithClipboard: () => void
  showNotifications: () => void
  gitFileHistory: () => void
  gitSelectionHistory: () => void
  gitBranches: () => void
  gitNextChange: () => void
  gitAnnotate: () => void
  gitPrevChange: () => void
  gitFetch: () => void
  gitForcePush: () => void
  showHistory: () => void
  restoreHistory: () => void
  insertTemplate: () => void
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
  navBack: () => void
  navForward: () => void
  recentFiles: () => void
  recentLocations: () => void
  toggleBookmark: () => void
  showBookmarks: () => void
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
  register({ id: 'file.closeOthers', category: 'File', title: 'Close Other Tabs', run: d.closeOtherTabs })
  register({ id: 'file.closeAll', category: 'File', title: 'Close All Tabs', run: d.closeAllTabs })
  register({ id: 'file.reopenClosed', category: 'File', title: 'Reopen Closed Tab', run: d.reopenClosedTab })
  register({ id: 'file.saveAll', category: 'File', title: 'Save All', run: d.saveAll })
  register({ id: 'file.reload', category: 'File', title: 'Reload from Disk', run: d.reloadFromDisk })
  register({ id: 'file.rename', category: 'File', title: 'Rename File…', keys: 'Shift+F6', run: d.renameCurrentFile })
  register({ id: 'file.new', category: 'File', title: 'New File…', run: d.newFile })
  register({ id: 'nav.search', category: 'Navigate', title: 'Search Everywhere', keys: 'Shift+Shift', run: d.openSearch })
  register({ id: 'nav.class', category: 'Navigate', title: 'Go to Class', keys: 'Ctrl+N', run: () => d.openSearchScope('symbols', true) })
  register({ id: 'nav.file', category: 'Navigate', title: 'Go to File', keys: 'Ctrl+Shift+N', run: () => d.openSearchScope('files') })
  register({ id: 'nav.symbol', category: 'Navigate', title: 'Go to Symbol', keys: 'Ctrl+Alt+Shift+N', run: () => d.openSearchScope('symbols') })
  register({ id: 'nav.action', category: 'Navigate', title: 'Find Action', keys: 'Ctrl+Shift+A', run: () => d.openSearchScope('actions') })
  register({ id: 'nav.back', category: 'Navigate', title: 'Back', keys: 'Ctrl+Alt+Left', run: d.navBack })
  register({ id: 'nav.forward', category: 'Navigate', title: 'Forward', keys: 'Ctrl+Alt+Right', run: d.navForward })
  register({ id: 'nav.recentFiles', category: 'Navigate', title: 'Recent Files', keys: 'Ctrl+E', run: d.recentFiles })
  register({ id: 'nav.recentLocations', category: 'Navigate', title: 'Recent Locations', keys: 'Ctrl+Shift+E', run: d.recentLocations })
  register({ id: 'bookmark.toggle', category: 'Navigate', title: 'Toggle Bookmark', keys: 'Ctrl+F11', run: d.toggleBookmark })
  register({ id: 'bookmark.list', category: 'Navigate', title: 'Show Bookmarks', keys: 'Shift+F11', run: d.showBookmarks })
  register({ id: 'nav.find', category: 'Navigate', title: 'Find in Project', keys: 'Ctrl+Shift+F', run: d.showFind })

  // ---- View ----
  register({ id: 'view.project', category: 'View', title: 'Toggle Project Window', keys: 'Alt+1', run: () => d.toggleSide('project') })
  register({ id: 'view.commit', category: 'View', title: 'Toggle Commit Window', keys: 'Alt+0', run: () => d.toggleSide('commit') })
  register({ id: 'view.output', category: 'View', title: 'Toggle Output', keys: 'Alt+2', run: () => d.toggleView('output') })
  register({ id: 'view.terminal', category: 'View', title: 'Toggle Terminal', keys: 'Alt+3', run: () => d.toggleView('terminal') })
  register({ id: 'view.problems', category: 'View', title: 'Toggle Problems', keys: 'Alt+6', run: () => d.toggleView('problems') })
  register({ id: 'view.structure', category: 'View', title: 'Toggle Structure', keys: 'Alt+7', run: () => d.toggleView('structure') })
  register({ id: 'view.bookmarks', category: 'View', title: 'Toggle Bookmarks', run: () => d.toggleView('bookmarks') })
  register({ id: 'view.hierarchy', category: 'View', title: 'Toggle Hierarchy', run: () => d.toggleView('hierarchy') })
  register({ id: 'view.run', category: 'View', title: 'Toggle Run Window', run: () => d.toggleView('run') })
  register({ id: 'view.debug', category: 'View', title: 'Toggle Debug Window', run: () => d.toggleView('debug') })
  register({ id: 'view.splitTerminal', category: 'View', title: 'Split Terminal', run: d.splitTerminal })
  register({ id: 'view.newTerminal', category: 'View', title: 'New Terminal', keys: 'Ctrl+Shift+`', run: d.newTerminal })
  register({ id: 'view.zen', category: 'View', title: 'Toggle Zen Mode', keys: 'Ctrl+Alt+Z', run: d.toggleZen })
  register({ id: 'view.presentation', category: 'View', title: 'Toggle Presentation Mode', run: d.togglePresentation })
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
  register({ id: 'settings.export', category: 'Settings', title: 'Export Settings…', run: d.exportSettings })
  register({ id: 'settings.import', category: 'Settings', title: 'Import Settings…', run: d.importSettings })
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
  toggle('Appearance', 'Hidden Files in Project Tree', 'treeShowHidden')
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
  register({ id: 'code.declaration', category: 'Code', title: 'Go to Declaration', keys: 'Ctrl+B', run: () => d.editorAction('editor.action.revealDefinition') })
  register({ id: 'code.implementation', category: 'Code', title: 'Go to Implementation', keys: 'Ctrl+Alt+B', run: () => d.editorAction('forge.goImplementation') })
  register({ id: 'code.typeDefinition', category: 'Code', title: 'Go to Type Definition', keys: 'Ctrl+Shift+B', run: () => d.editorAction('forge.goTypeDefinition') })
  register({ id: 'code.symbolInFile', category: 'Code', title: 'Go to Symbol in File', keys: 'Ctrl+Shift+O', run: () => d.editorAction('editor.action.quickOutline') })
  register({ id: 'code.gotoLine', category: 'Code', title: 'Go to Line', keys: 'Ctrl+G', run: () => d.editorAction('editor.action.gotoLine') })
  register({ id: 'code.organizeImports', category: 'Code', title: 'Optimize Imports', keys: 'Ctrl+Alt+O', run: () => d.editorAction('forge.organizeImports') })
  register({ id: 'code.callHierarchy', category: 'Code', title: 'Call Hierarchy', keys: 'Ctrl+Alt+H', run: () => d.editorAction('forge.callHierarchy') })
  register({ id: 'code.typeHierarchy', category: 'Code', title: 'Type Hierarchy', run: () => d.editorAction('forge.typeHierarchy') })
  register({ id: 'code.quickDoc', category: 'Code', title: 'Quick Documentation', keys: 'Ctrl+Q', run: () => d.editorAction('editor.action.showHover') })
  register({ id: 'code.quickDefinition', category: 'Code', title: 'Quick Definition', keys: 'Ctrl+Shift+I', run: () => d.editorAction('editor.action.peekDefinition') })
  register({ id: 'code.paramInfo', category: 'Code', title: 'Parameter Info', keys: 'Ctrl+P', run: () => d.editorAction('editor.action.triggerParameterHints') })
  register({ id: 'code.extendSelection', category: 'Code', title: 'Extend Selection', keys: 'Shift+Alt+Right', run: () => d.editorAction('editor.action.smartSelect.expand') })
  register({ id: 'code.shrinkSelection', category: 'Code', title: 'Shrink Selection', keys: 'Shift+Alt+Left', run: () => d.editorAction('editor.action.smartSelect.shrink') })
  register({ id: 'code.comment', category: 'Code', title: 'Comment with Line Comment', keys: 'Ctrl+/', run: () => d.editorAction('editor.action.commentLine') })
  register({ id: 'code.duplicateLine', category: 'Code', title: 'Duplicate Line', keys: 'Shift+Alt+Down', run: () => d.editorAction('editor.action.copyLinesDownAction') })
  register({ id: 'code.deleteLine', category: 'Code', title: 'Delete Line', keys: 'Ctrl+Shift+K', run: () => d.editorAction('editor.action.deleteLines') })
  register({ id: 'file.newScratch', category: 'File', title: 'New Scratch File…', keys: 'Ctrl+Alt+Shift+Insert', run: d.newScratch })
  register({ id: 'file.scratches', category: 'File', title: 'Show Scratch Files', run: d.showScratches })
  register({ id: 'code.compareFile', category: 'Code', title: 'Compare with File…', run: d.compareWithFile })
  register({ id: 'code.compareClipboard', category: 'Code', title: 'Compare with Clipboard', run: d.compareWithClipboard })
  register({ id: 'view.notifications', category: 'View', title: 'Show Notifications', run: d.showNotifications })
  register({ id: 'view.docker', category: 'View', title: 'Toggle Docker', run: () => d.toggleView('docker') })
  register({ id: 'view.github', category: 'View', title: 'Toggle Pull Requests (GitHub)', run: () => d.toggleView('github') })
  register({ id: 'view.viewer', category: 'View', title: 'Toggle Viewer (Table / Notebook / Hex)', run: () => d.toggleView('viewer') })
  register({ id: 'view.preview', category: 'View', title: 'Toggle Markdown Preview', run: () => d.toggleView('preview') })
  register({ id: 'view.breakpoints', category: 'View', title: 'Toggle Breakpoints Window', keys: 'Ctrl+Shift+F8', run: () => d.toggleView('breakpoints') })
  register({ id: 'view.http', category: 'View', title: 'Toggle HTTP Response', run: () => d.toggleView('http') })
  register({ id: 'http.run', category: 'Code', title: 'Run HTTP Request', keys: 'Ctrl+Enter', run: d.runHttp })
  register({ id: 'run.tests', category: 'Run', title: 'Run Tests in This File', run: d.runTests })
  register({ id: 'editor.splitRight', category: 'View', title: 'Split Right', run: () => d.splitEditor('right') })
  register({ id: 'editor.splitDown', category: 'View', title: 'Split Down', run: () => d.splitEditor('down') })
  register({ id: 'editor.unsplit', category: 'View', title: 'Unsplit', run: () => d.splitEditor('none') })
  register({ id: 'code.inspect', category: 'Code', title: 'Inspect Code', run: d.inspectCode })
  register({ id: 'view.saveLayout', category: 'View', title: 'Save Layout As…', run: d.saveLayoutAs })
  register({ id: 'view.applyLayout', category: 'View', title: 'Apply Layout…', run: d.chooseLayout })
  register({ id: 'view.deleteLayout', category: 'View', title: 'Delete Saved Layout…', run: d.deleteLayout })
  register({ id: 'view.resetLayout', category: 'View', title: 'Reset Layout', run: d.resetLayout })
  register({ id: 'nav.goToTest', category: 'Navigate', title: 'Go to Test / Source', keys: 'Ctrl+Shift+T', run: d.goToTest })
  register({ id: 'spell.addWord', category: 'Code', title: 'Add Word at Cursor to Dictionary', run: d.addWordToDictionary })
  register({ id: 'code.duplicates', category: 'Code', title: 'Find Duplicated Code', run: d.findDuplicates })
  register({ id: 'test.runAll', category: 'Run', title: 'Run All Tests', run: d.runAllTests })
  register({ id: 'view.tests', category: 'View', title: 'Toggle Test Explorer', run: () => d.toggleView('tests') })
  register({ id: 'view.npm', category: 'View', title: 'Toggle npm Window', run: () => d.toggleView('npm') })
  register({ id: 'view.database', category: 'View', title: 'Toggle Database Window', run: () => d.toggleView('database') })
  register({ id: 'ai.toggle', category: 'AI', title: 'Toggle AI Assistant', keys: 'Alt+8', run: () => d.toggleView('ai') })
  register({ id: 'ai.newChat', category: 'AI', title: 'New AI Chat', run: d.aiNewChat })
  register({ id: 'ai.explain', category: 'AI', title: 'Explain Code', run: () => d.aiAction('explain') })
  register({ id: 'ai.fix', category: 'AI', title: 'Find and Fix Problems', run: () => d.aiAction('fix') })
  register({ id: 'ai.tests', category: 'AI', title: 'Write Tests', run: () => d.aiAction('tests') })
  register({ id: 'ai.document', category: 'AI', title: 'Write Documentation', run: () => d.aiAction('document') })
  register({ id: 'ai.refactor', category: 'AI', title: 'Suggest Refactoring', run: () => d.aiAction('refactor') })
  register({ id: 'tab.next', category: 'Navigate', title: 'Next Tab', keys: 'Ctrl+Tab', run: () => d.nextTab(1) })
  register({ id: 'tab.prev', category: 'Navigate', title: 'Previous Tab', keys: 'Ctrl+Shift+Tab', run: () => d.nextTab(-1) })
  register({ id: 'file.openInBrowser', category: 'File', title: 'Open in Browser', run: d.openInBrowser })
  register({ id: 'view.todo', category: 'View', title: 'Toggle TODO Window', run: () => d.toggleView('todo') })
  register({ id: 'nav.replaceInFiles', category: 'Navigate', title: 'Replace in Files', keys: 'Ctrl+Shift+R', run: d.findReplace })
  register({ id: 'view.git', category: 'View', title: 'Toggle Git Window', keys: 'Alt+9', run: () => d.toggleView('git') })
  register({ id: 'git.selectionHistory', category: 'Git', title: 'Show History for Selection', run: d.gitSelectionHistory })
  register({ id: 'git.fileHistory', category: 'Git', title: 'Show Git History for File', run: d.gitFileHistory })
  register({ id: 'git.branches', category: 'Git', title: 'Branches…', run: d.gitBranches })
  register({ id: 'git.annotate', category: 'Git', title: 'Annotate with Git Blame', run: d.gitAnnotate })
  register({ id: 'git.nextChange', category: 'Git', title: 'Next Change', keys: 'Ctrl+Alt+Shift+Down', run: d.gitNextChange })
  register({ id: 'git.prevChange', category: 'Git', title: 'Previous Change', keys: 'Ctrl+Alt+Shift+Up', run: d.gitPrevChange })
  toggle('Editor', 'Git Changes in the Gutter', 'gitGutter')
  register({ id: 'git.forcePush', category: 'Git', title: 'Force Push (with lease)', run: d.gitForcePush })
  register({ id: 'git.fetch', category: 'Git', title: 'Fetch', run: d.gitFetch })
  register({ id: 'history.show', category: 'Code', title: 'Show Local History', run: d.showHistory })
  register({ id: 'history.restore', category: 'Code', title: 'Restore from Local History', run: d.restoreHistory })
  register({ id: 'code.surround', category: 'Code', title: 'Surround With…', keys: 'Ctrl+Alt+T', run: d.surround })
  register({ id: 'code.liveTemplate', category: 'Code', title: 'Insert Live Template…', keys: 'Ctrl+J', run: d.insertTemplate })
  register({ id: 'code.snippetsFolder', category: 'Code', title: 'Open Snippets Folder', run: d.openSnippetsDir })
  register({ id: 'code.selectNext', category: 'Code', title: 'Add Selection for Next Occurrence', keys: 'Ctrl+D', run: () => d.editorAction('editor.action.addSelectionToNextFindMatch') })
  register({ id: 'code.unselectNext', category: 'Code', title: 'Unselect Last Occurrence', run: () => d.editorAction('cursorUndo') })
  register({ id: 'code.selectAllOccurrences', category: 'Code', title: 'Select All Occurrences', keys: 'Ctrl+Shift+L', run: () => d.editorAction('editor.action.selectHighlights') })
  register({ id: 'code.replace', category: 'Code', title: 'Replace in File', keys: 'Ctrl+H', run: () => d.editorAction('editor.action.startFindReplace') })
  register({ id: 'code.commentBlock', category: 'Code', title: 'Comment with Block Comment', keys: 'Shift+Alt+A', run: () => d.editorAction('editor.action.blockComment') })
  register({ id: 'code.highlightUsages', category: 'Code', title: 'Highlight Usages in File', run: () => d.editorAction('editor.action.wordHighlight.trigger') })
  register({ id: 'code.intentions', category: 'Code', title: 'Show Intention Actions', keys: 'Alt+Enter', run: () => d.editorAction('editor.action.quickFix') })
  register({ id: 'code.moveLineUp', category: 'Code', title: 'Move Line Up', keys: 'Alt+Up', run: () => d.editorAction('editor.action.moveLinesUpAction') })
  register({ id: 'code.moveLineDown', category: 'Code', title: 'Move Line Down', keys: 'Alt+Down', run: () => d.editorAction('editor.action.moveLinesDownAction') })
  register({ id: 'code.joinLines', category: 'Code', title: 'Join Lines', run: () => d.editorAction('editor.action.joinLines') })
  register({ id: 'code.upper', category: 'Code', title: 'To UPPER CASE', run: () => d.editorAction('editor.action.transformToUppercase') })
  register({ id: 'code.lower', category: 'Code', title: 'To lower case', run: () => d.editorAction('editor.action.transformToLowercase') })
  register({ id: 'code.sortLines', category: 'Code', title: 'Sort Lines Ascending', run: () => d.editorAction('editor.action.sortLinesAscending') })
  register({ id: 'code.sortLinesDesc', category: 'Code', title: 'Sort Lines Descending', run: () => d.editorAction('editor.action.sortLinesDescending') })
  register({ id: 'code.removeDuplicateLines', category: 'Code', title: 'Remove Duplicate Lines', run: () => d.editorAction('editor.action.removeDuplicateLines') })
  register({ id: 'code.trimTrailing', category: 'Code', title: 'Trim Trailing Whitespace', run: () => d.editorAction('editor.action.trimTrailingWhitespace') })
  register({ id: 'code.camel', category: 'Code', title: 'To camelCase', run: () => d.editorAction('editor.action.transformToCamelcase') })
  register({ id: 'code.pascal', category: 'Code', title: 'To PascalCase', run: () => d.editorAction('editor.action.transformToPascalcase') })
  register({ id: 'code.snake', category: 'Code', title: 'To snake_case', run: () => d.editorAction('editor.action.transformToSnakecase') })
  register({ id: 'code.kebab', category: 'Code', title: 'To kebab-case', run: () => d.editorAction('editor.action.transformToKebabcase') })
  register({ id: 'code.title', category: 'Code', title: 'To Title Case', run: () => d.editorAction('editor.action.transformToTitlecase') })
  register({ id: 'code.foldAll', category: 'Code', title: 'Collapse All', run: () => d.editorAction('editor.foldAll') })
  register({ id: 'code.unfoldAll', category: 'Code', title: 'Expand All', run: () => d.editorAction('editor.unfoldAll') })
  register({ id: 'code.foldRegion', category: 'Code', title: 'Collapse Region', keys: 'Ctrl+Shift+[', run: () => d.editorAction('editor.fold') })
  register({ id: 'code.unfoldRegion', category: 'Code', title: 'Expand Region', keys: 'Ctrl+Shift+]', run: () => d.editorAction('editor.unfold') })
  register({ id: 'code.refactor', category: 'Code', title: 'Refactor This…', keys: 'Ctrl+Alt+Shift+T', run: () => d.editorAction('editor.action.refactor') })

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
