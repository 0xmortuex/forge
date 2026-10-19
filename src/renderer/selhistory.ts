import type { SelectionCommit } from '../main/git'

// "Show History for Selection": the commits that changed the selected lines (git log -L), newest first, and for the one picked,
// the diff of just those lines.

export function showSelectionHistory(file: string, range: string, commits: SelectionCommit[], copy: (text: string) => void): Promise<void> {
  return new Promise((resolve) => {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag)
      if (cls) e.className = cls
      if (text) e.textContent = text
      return e
    }

    const overlay = el('div', 'overlay')
    overlay.id = 'selhistory'
    const box = el('div', 'modal selhist-box')
    const head = el('div', 'selhist-head')
    head.append(el('div', 'selhist-title', `History of ${range} in ${file}`), el('div', 'selhist-sub', `${commits.length} commit${commits.length === 1 ? '' : 's'} touched these lines`))
    const body = el('div', 'selhist-body')
    const list = el('div', 'selhist-list')
    list.id = 'selhist-list'
    const patch = el('pre', 'selhist-patch')
    patch.id = 'selhist-patch'
    body.append(list, patch)
    const foot = el('div', 'selhist-foot')
    const copyBtn = el('button', 'btn', 'Copy Revision Number')
    copyBtn.id = 'selhist-copy'
    const close = el('button', 'btn-primary', 'Close')
    close.id = 'selhist-close'
    foot.append(copyBtn, el('span', 'grow'), close)
    box.append(head, body, foot)
    overlay.append(box)

    let current = 0
    const rows: HTMLElement[] = []

    function show(i: number): void {
      current = i
      rows.forEach((r, j) => r.classList.toggle('sel', j === i))
      patch.replaceChildren()
      const c = commits[i]
      if (!c) return
      for (const line of c.patch.split('\n')) {
        const row = el('div', line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') ? 'meta' : '')
        row.textContent = line || ' '
        patch.append(row)
      }
    }

    commits.forEach((c, i) => {
      const row = el('div', 'selhist-commit')
      row.dataset['sha'] = c.sha
      row.append(el('div', 'selhist-subject', c.subject), el('div', 'selhist-meta', `${c.sha.slice(0, 7)} · ${c.author} · ${new Date(c.date).toLocaleDateString()}`))
      row.onclick = () => show(i)
      rows.push(row)
      list.append(row)
    })
    if (!commits.length) list.append(el('div', 'hint', 'No commit has changed these lines yet'))

    const finish = (): void => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish()
      }
    }
    document.addEventListener('keydown', onKey, true)
    close.onclick = finish
    copyBtn.onclick = () => {
      const c = commits[current]
      if (c) copy(c.sha)
    }
    overlay.onmousedown = (e) => {
      if (e.target === overlay) finish()
    }
    document.body.append(overlay)
    show(0)
    close.focus()
  })
}
