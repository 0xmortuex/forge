export interface MenuItem {
  label: string
  danger?: boolean
  run: () => void
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

const ctx = byId('ctx')

function hideMenu(): void {
  ctx.hidden = true
  ctx.replaceChildren()
}

export function showMenu(x: number, y: number, items: (MenuItem | 'sep')[]): void {
  hideMenu()
  for (const item of items) {
    if (item === 'sep') {
      const sep = document.createElement('div')
      sep.className = 'ctx-sep'
      ctx.append(sep)
      continue
    }
    const row = document.createElement('div')
    row.className = 'ctx-item' + (item.danger ? ' danger' : '')
    row.textContent = item.label
    row.onclick = () => {
      hideMenu()
      item.run()
    }
    ctx.append(row)
  }
  ctx.hidden = false
  // Keep the menu inside the window.
  ctx.style.left = `${Math.min(x, window.innerWidth - ctx.offsetWidth - 8)}px`
  ctx.style.top = `${Math.min(y, window.innerHeight - ctx.offsetHeight - 8)}px`
}

// Close on any press outside the menu, Escape, or window blur.
window.addEventListener('mousedown', (e) => {
  if (!ctx.hidden && !ctx.contains(e.target as Node)) hideMenu()
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideMenu()
})
window.addEventListener('blur', hideMenu)

const ask = byId('ask')
const askForm = byId<HTMLFormElement>('ask-box')
const askTitle = byId('ask-title')
const askInput = byId<HTMLInputElement>('ask-input')

/** Electron has no window.prompt, so this is our own. Resolves null if cancelled or empty. */
export function askText(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const done = (value: string | null): void => {
      ask.hidden = true
      askForm.onsubmit = null
      askInput.onkeydown = null
      ask.onmousedown = null
      resolve(value)
    }
    askTitle.textContent = title
    askInput.value = initial
    ask.hidden = false
    askInput.focus()
    // Select the base name, not the extension, like JetBrains does.
    const dot = initial.lastIndexOf('.')
    askInput.setSelectionRange(0, dot > 0 ? dot : initial.length)
    askForm.onsubmit = (e) => {
      e.preventDefault()
      done(askInput.value.trim() || null)
    }
    askInput.onkeydown = (e) => {
      if (e.key === 'Escape') done(null)
    }
    ask.onmousedown = (e) => {
      if (e.target === ask) done(null)
    }
  })
}
