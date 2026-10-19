// The keymap presets: sets of shortcuts that sit underneath the user's own. Data only (command id -> shortcut), so it can be
// checked without a window. A preset only lists what differs from Forge's own defaults, and avoids keys that Forge itself
// owns in every window (F9 resume, F11 full screen, ...).

export const KEYMAP_PRESETS: [id: string, label: string][] = [
  ['forge', 'Forge (default)'],
  ['intellij', 'IntelliJ IDEA'],
  ['vscode', 'Visual Studio Code'],
  ['visualstudio', 'Visual Studio']
]

// Preset commands that work anywhere in the window. Every other preset shortcut works only while the editor has focus,
// so Ctrl+D is not stolen from a terminal (end of input) or Ctrl+Y from a text box (redo).
export const GLOBAL_PRESET_COMMANDS = new Set(['file.close'])

export const PRESETS: Record<string, Record<string, string>> = {
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
  },
  // Visual Studio Code's defaults (the ones that are a single key combination: its Ctrl+K chords are not available).
  vscode: {
    'code.duplicateLine': 'Shift+Alt+Down',
    'code.deleteLine': 'Ctrl+Shift+K',
    'code.moveLineUp': 'Alt+Up',
    'code.moveLineDown': 'Alt+Down',
    'code.selectNext': 'Ctrl+D',
    'code.selectAllOccurrences': 'Ctrl+Shift+L',
    'code.commentBlock': 'Shift+Alt+A',
    'code.foldRegion': 'Ctrl+Shift+[',
    'code.unfoldRegion': 'Ctrl+Shift+]',
    'editor.format': 'Shift+Alt+F',
    'code.organizeImports': 'Shift+Alt+O',
    'editor.usages': 'Shift+F12',
    'nav.file': 'Ctrl+P',
    'nav.symbol': 'Ctrl+T',
    'nav.back': 'Alt+Left',
    'nav.forward': 'Alt+Right',
    'nav.replaceInFiles': 'Ctrl+Shift+H',
    'view.project': 'Ctrl+B',
    'view.output': 'Ctrl+Shift+U',
    'view.problems': 'Ctrl+Shift+M',
    'view.git': 'Ctrl+Shift+G',
    'settings.extensions': 'Ctrl+Shift+X',
    'run.debug': 'F5',
    'run.run': 'Ctrl+F5',
    'run.stop': 'Shift+F5',
    'debug.over': 'F10'
  },
  // Visual Studio's default scheme (single combinations only; F9 and F11 stay as Forge uses them).
  visualstudio: {
    'code.duplicateLine': 'Ctrl+D',
    'code.deleteLine': 'Ctrl+Shift+L',
    'code.moveLineUp': 'Alt+Up',
    'code.moveLineDown': 'Alt+Down',
    'code.upper': 'Ctrl+Shift+U',
    'code.lower': 'Ctrl+U',
    'editor.usages': 'Shift+F12',
    'nav.action': 'Ctrl+Q',
    'nav.symbol': 'Ctrl+T',
    'nav.back': 'Ctrl+-',
    'nav.forward': 'Ctrl+Shift+-',
    'nav.replaceInFiles': 'Ctrl+Shift+H',
    'file.saveAll': 'Ctrl+Shift+S',
    'view.project': 'Ctrl+Alt+L',
    'view.output': 'Ctrl+Alt+O',
    'view.fullscreen': 'Shift+Alt+Enter',
    'run.debug': 'F5',
    'run.run': 'Ctrl+F5',
    'run.stop': 'Shift+F5',
    'debug.over': 'F10'
  }
}
