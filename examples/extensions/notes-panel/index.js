// Notes Panel: an example extension that adds a tool window (forge.ui.panel), remembers data between sessions
// (forge.storage) and follows the active file (the 'activate' event). See docs/EXTENSIONS.md for the full API.
//
// Install: copy this folder into Forge's extensions folder (Settings > Extensions > Open extensions folder),
// reopen the Extensions page, and switch it on. The panel's button appears on the right edge.

export function activate(forge) {
  let current = null // the path of the file whose note is showing

  const panel = forge.ui.panel({
    id: 'notes',
    title: 'Notes',
    dock: 'right',
    render(root) {
      root.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px'

      const heading = document.createElement('div')
      heading.className = 'hint'
      heading.id = 'notes-heading'

      const box = document.createElement('textarea')
      box.id = 'notes-box'
      box.className = 'field'
      box.rows = 12
      box.placeholder = 'Write a note about this file…'
      box.spellcheck = false
      box.style.flex = '1'
      box.oninput = () => {
        if (current) forge.storage.set(`note:${current}`, box.value)
      }

      root.append(heading, box)

      // Shows the note of whichever file is in the editor.
      const show = (path) => {
        current = path
        heading.textContent = path ? `Note for ${path.split(/[\\/]/).pop()}` : 'Open a file to write a note'
        box.disabled = !path
        box.value = path ? forge.storage.get(`note:${path}`, '') : ''
      }
      show(forge.editor.getFilePath())
      const off = forge.on('activate', ({ path }) => show(path))
      return off // cleaned up when the extension is switched off
    }
  })

  forge.commands.register({ id: 'open', title: 'Open Notes', run: () => panel.show() })
}
