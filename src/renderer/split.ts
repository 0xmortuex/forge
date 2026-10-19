import * as monaco from 'monaco-editor'

// Split editor: a second pane beside (or below) the main editor, showing the same file or another open one. Both panes
// edit the same text, so typing in one appears in the other. The second pane has Monaco's own features (completion,
// hover, definition, search, multi-cursor ...); refactorings and other Forge actions run from the main editor.

export type Orientation = 'right' | 'down'

export interface SplitDeps {
  /** The container holding both panes. */
  area: HTMLElement
  pane: HTMLElement
  splitter: HTMLElement
  host: HTMLElement
  name: HTMLElement
  /** The open model for a path, if the file is open in a tab. */
  getModel: (path: string) => monaco.editor.ITextModel | undefined
  /** Creates the editor in `host`, styled and kept in step with the settings. */
  makeEditor: (host: HTMLElement) => monaco.editor.IStandaloneCodeEditor
  /** Saves a file (Ctrl+S inside the split). */
  save: (path: string) => void
  /** Brings a file to the main pane. */
  activate: (path: string) => void
  /** The change that session saving should know about. */
  changed: () => void
}

export interface Split {
  open: (path: string, orientation: Orientation) => void
  close: () => void
  isOpen: () => boolean
  path: () => string | null
  /** A file's tab was closed: if the split shows it, the split goes. */
  onFileClosed: (path: string) => void
  orientation: () => Orientation
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function initSplit(d: SplitDeps): Split {
  let editor: monaco.editor.IStandaloneCodeEditor | null = null
  let shown: string | null = null
  let how: Orientation = 'right'

  const head = d.pane.querySelector('#pane2-head')
  const closeBtn = document.getElementById('pane2-close')
  const swapBtn = document.getElementById('pane2-swap')
  if (!head || !closeBtn || !swapBtn) throw new Error('Split pane elements missing from index.html')

  function layout(): void {
    d.area.classList.toggle('stack', how === 'down')
    d.splitter.classList.toggle('v', how === 'right')
    d.splitter.classList.toggle('h', how === 'down')
  }

  function close(): void {
    if (!shown) return
    editor?.setModel(null) // let go of the model before its tab (and the model) can go away
    shown = null
    d.pane.hidden = true
    d.splitter.hidden = true
    d.pane.style.width = ''
    d.pane.style.height = ''
    d.changed()
  }

  function open(path: string, orientation: Orientation): void {
    const model = d.getModel(path)
    if (!model) throw new Error(`${basename(path)} is not open`)
    how = orientation
    editor ??= (() => {
      const e = d.makeEditor(d.host)
      // Ctrl+S saves the file shown in this pane.
      e.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (shown) d.save(shown)
      })
      return e
    })()
    editor.setModel(model)
    shown = path
    d.name.textContent = basename(path)
    d.pane.hidden = false
    d.splitter.hidden = false
    layout()
    editor.layout()
    d.changed()
  }

  closeBtn.onclick = close
  swapBtn.onclick = () => {
    if (shown) d.activate(shown)
  }

  // Dragging the splitter resizes the second pane.
  d.splitter.onmousedown = (down) => {
    down.preventDefault()
    const vertical = how === 'right'
    const start = vertical ? down.clientX : down.clientY
    const startSize = vertical ? d.pane.offsetWidth : d.pane.offsetHeight
    const move = (e: MouseEvent): void => {
      const delta = start - (vertical ? e.clientX : e.clientY) // the second pane is on the right / bottom
      const size = Math.max(160, startSize + delta)
      d.pane.style.flex = 'none'
      d.pane.style[vertical ? 'width' : 'height'] = `${size}px`
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return {
    open,
    close,
    isOpen: () => shown !== null,
    path: () => shown,
    orientation: () => how,
    onFileClosed(path) {
      if (shown && shown.toLowerCase() === path.toLowerCase()) close()
    }
  }
}
