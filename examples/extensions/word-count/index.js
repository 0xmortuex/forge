// Word Count: a small example extension for Forge.
//
// Install: copy this whole folder into Forge's extensions folder (Settings > Extensions > Open extensions
// folder), reopen the Extensions page, and switch it on. See docs/EXTENSIONS.md for the full API.

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0)

export function activate(forge) {
  // A status bar item on the right. Clicking it shows the count for the selection.
  const status = forge.ui.statusItem({
    text: 'Words: -',
    tooltip: 'Words in the active file (click for the selection)',
    onClick: () => showCount()
  })

  function refresh() {
    const text = forge.editor.getText()
    status.update(text === null ? 'Words: -' : `Words: ${countWords(text)}`)
  }

  function showCount() {
    const selection = forge.editor.getSelectedText()
    const text = selection || forge.editor.getText()
    if (text === null) return forge.ui.toast('Open a file first', 'warn')
    const n = countWords(text)
    forge.ui.toast(`${n} word${n === 1 ? '' : 's'}${selection ? ' in the selection' : ' in the file'}`, 'ok')
  }

  // Commands appear in the Command Palette (Ctrl+Shift+P) under the extension's name.
  forge.commands.register({ id: 'show', title: 'Show Word Count', run: showCount })
  forge.commands.register({
    id: 'uppercase',
    title: 'Uppercase Selection',
    run: () => {
      const selection = forge.editor.getSelectedText()
      if (!selection) return forge.ui.toast('Select some text first', 'warn')
      forge.editor.replaceSelection(selection.toUpperCase())
    }
  })

  // Keep the status item current as files are opened and saved.
  forge.on('open', refresh)
  forge.on('save', refresh)
  refresh()
}
