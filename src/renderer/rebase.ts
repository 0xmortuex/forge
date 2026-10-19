import type { RebaseInfo } from '../main/git'
import { planProblem, type RebaseAction, type RebaseStep } from '../main/rebaseplan'

// "Interactive Rebase": the commits that would be rewritten, oldest first, each with an action (keep, reword, squash into the
// one before, fixup, drop). Commits can be moved up and down. Nothing happens until Start; Cancel changes nothing.

const ACTIONS: { value: RebaseAction; label: string; hint: string }[] = [
  { value: 'pick', label: 'Pick', hint: 'Keep the commit as it is' },
  { value: 'reword', label: 'Reword', hint: 'Keep the changes, write a new message' },
  { value: 'squash', label: 'Squash', hint: 'Fold into the commit above, keeping its message in the combined one' },
  { value: 'fixup', label: 'Fixup', hint: 'Fold into the commit above and discard its message' },
  { value: 'drop', label: 'Drop', hint: 'Remove the commit and its changes' }
]

interface Row {
  sha: string
  subject: string
  original: string
  pushed: boolean
  action: RebaseAction
  /** The text of the message box (reword, or a combined message), once the user has edited it. */
  edited?: string
}

/** Resolves to the plan (oldest first), or null if the user cancelled. */
export function chooseRebase(info: RebaseInfo): Promise<RebaseStep[] | null> {
  return new Promise((resolve) => {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag)
      if (cls) e.className = cls
      if (text) e.textContent = text
      return e
    }

    const rows: Row[] = info.commits.map((c) => ({ sha: c.sha, subject: c.subject, original: c.message, pushed: c.pushed, action: 'pick' }))

    const overlay = el('div', 'overlay')
    overlay.id = 'rebase'
    const box = el('div', 'modal rebase-box')
    const head = el('div', 'rebase-head')
    head.append(el('div', 'rebase-title', `Interactive rebase: ${rows.length} commit${rows.length === 1 ? '' : 's'}`), el('div', 'rebase-sub', 'Oldest first, the order git applies them in'))
    const warn = el('div', 'rebase-warn')
    warn.id = 'rebase-warn'
    const list = el('div', 'rebase-list')
    list.id = 'rebase-list'
    const foot = el('div', 'rebase-foot')
    const problem = el('div', 'rebase-problem')
    problem.id = 'rebase-problem'
    const cancel = el('button', 'btn', 'Cancel')
    cancel.id = 'rebase-cancel'
    const start = el('button', 'btn-primary', 'Start Rebase')
    start.id = 'rebase-start'
    foot.append(problem, cancel, start)
    box.append(head, warn, list, foot)
    overlay.append(box)

    /** The steps as they stand, with the message each chain head should carry. */
    const steps = (): RebaseStep[] =>
      rows.map((r) => ({
        sha: r.sha,
        action: r.action,
        original: r.original,
        // An untouched reword keeps the message it shows; a combined message is only sent once it has been edited.
        message: r.action === 'reword' ? (r.edited ?? r.original) : r.action === 'pick' ? r.edited : undefined
      }))

    /** The squashed commits that follow a pick/reword (dropped ones between do not break the chain). */
    const squashedInto = (i: number): Row[] => {
      const out: Row[] = []
      for (let j = i + 1; j < rows.length; j++) {
        const r = rows[j] as Row
        if (r.action === 'drop') continue
        if (r.action === 'squash') out.push(r)
        else if (r.action !== 'fixup') break
      }
      return out
    }

    function draw(): void {
      list.replaceChildren()
      const firstActive = rows.findIndex((r) => r.action !== 'drop')
      rows.forEach((r, i) => {
        const item = el('div', `rebase-row ${r.action}`)
        item.dataset['sha'] = r.sha
        const sel = el('select', 'field rebase-action')
        for (const a of ACTIONS) {
          const o = el('option', '', a.label)
          o.value = a.value
          o.title = a.hint
          // Nothing comes before the first kept commit to fold into.
          o.disabled = (a.value === 'squash' || a.value === 'fixup') && i === firstActive
          sel.append(o)
        }
        sel.value = r.action
        sel.onchange = () => {
          r.action = sel.value as RebaseAction
          draw()
        }
        const sha = el('span', 'rebase-sha', r.sha.slice(0, 7))
        const subject = el('span', 'rebase-subject', r.subject)
        subject.title = r.original
        const up = el('button', 'icon-btn small rebase-up', '↑')
        up.title = 'Move up (earlier)'
        up.disabled = i === 0
        up.onclick = () => {
          const [x] = rows.splice(i, 1)
          rows.splice(i - 1, 0, x as Row)
          draw()
        }
        const down = el('button', 'icon-btn small rebase-down', '↓')
        down.title = 'Move down (later)'
        down.disabled = i === rows.length - 1
        down.onclick = () => {
          const [x] = rows.splice(i, 1)
          rows.splice(i + 1, 0, x as Row)
          draw()
        }
        item.append(sel, sha, subject)
        if (r.pushed) item.append(el('span', 'rebase-pushed', 'pushed'))
        item.append(up, down)
        list.append(item)

        const squashed = r.action === 'pick' || r.action === 'reword' ? squashedInto(i) : []
        if (r.action === 'reword' || squashed.length) {
          const label = el('div', 'rebase-msg-label', r.action === 'reword' ? 'New message' : `Message of the combined commit (${squashed.length + 1} commits)`)
          const area = el('textarea', 'field rebase-msg')
          area.spellcheck = false
          area.rows = 3
          area.value = r.edited ?? (r.action === 'reword' ? r.original : [r, ...squashed].map((x) => x.original.trim()).join('\n\n'))
          area.oninput = () => {
            r.edited = area.value
            refreshState()
          }
          list.append(label, area)
        }
      })
      refreshState()
    }

    function refreshState(): void {
      const pushed = rows.filter((r) => r.pushed && r.action !== 'pick').length
      warn.hidden = !rows.some((r) => r.pushed)
      warn.textContent = info.upstream
        ? `Some of these commits are already on ${info.upstream}. Rewriting them means a force push, and anyone who has them will have to reconcile.${pushed ? '' : ' (None of the pushed ones are changed so far.)'}`
        : ''
      const why = planProblem(steps())
      problem.textContent = why ?? ''
      start.disabled = why !== null
    }

    const finish = (result: RebaseStep[] | null): void => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(result)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(null)
      }
    }
    document.addEventListener('keydown', onKey, true)
    cancel.onclick = () => finish(null)
    overlay.onmousedown = (e) => {
      if (e.target === overlay) finish(null)
    }
    start.onclick = () => finish(steps())

    document.body.append(overlay)
    draw()
    start.focus()
  })
}
