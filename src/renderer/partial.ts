import type { FileDiff } from '../main/gitpatch'

// "Choose Changes to Commit": a dialog listing a modified file's hunks, each with a checkbox, and every added or removed
// line with its own. What is ticked goes into the commit; the rest stays in the working file, uncommitted.

export interface PartialChoice {
  fingerprint: string
  /** Per hunk, the indices of the chosen added/removed lines. */
  selected: number[][]
  picked: number
  total: number
}

/** The ticks a choice stands for, as "hunk:line" keys. */
const keysOf = (choice: PartialChoice): Set<string> => new Set(choice.selected.flatMap((lines, h) => lines.map((i) => `${h}:${i}`)))

/**
 * Shows the dialog; resolves to the choice, or null if the user cancelled. `previous` is a choice made earlier for the same
 * diff (re-opening the dialog shows it again); anything else starts with every change ticked.
 */
export function chooseChanges(file: string, diff: FileDiff, previous?: PartialChoice): Promise<PartialChoice | null> {
  return new Promise((resolve) => {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag)
      if (cls) e.className = cls
      if (text) e.textContent = text
      return e
    }

    const all: string[] = diff.hunks.flatMap((h, hi) => h.lines.flatMap((l, li) => (l.kind === ' ' ? [] : [`${hi}:${li}`])))
    const ticked = previous && previous.fingerprint === diff.fingerprint ? keysOf(previous) : new Set(all)

    const overlay = el('div', 'overlay')
    overlay.id = 'partial'
    const box = el('div', 'modal partial-box')
    const head = el('div', 'partial-head')
    const title = el('div', 'partial-title', `Choose changes to commit: ${file}`)
    const count = el('div', 'partial-count')
    count.id = 'partial-count'
    head.append(title, count)
    const body = el('div', 'partial-body')
    body.id = 'partial-body'
    const foot = el('div', 'partial-foot')
    const allBtn = el('button', 'btn', 'Select All')
    allBtn.id = 'partial-all'
    const noneBtn = el('button', 'btn', 'Select None')
    noneBtn.id = 'partial-none'
    const spacer = el('span', 'grow')
    const cancel = el('button', 'btn', 'Cancel')
    cancel.id = 'partial-cancel'
    const done = el('button', 'btn-primary', 'Done')
    done.id = 'partial-done'
    foot.append(allBtn, noneBtn, spacer, cancel, done)
    box.append(head, body, foot)
    overlay.append(box)

    const hunkBoxes: HTMLInputElement[] = []
    const lineBoxes = new Map<string, HTMLInputElement>()

    const sync = (): void => {
      diff.hunks.forEach((h, hi) => {
        const keys = h.lines.flatMap((l, li) => (l.kind === ' ' ? [] : [`${hi}:${li}`]))
        const n = keys.filter((k) => ticked.has(k)).length
        const box = hunkBoxes[hi]
        if (box) {
          box.checked = n === keys.length
          box.indeterminate = n > 0 && n < keys.length
        }
      })
      for (const [k, box] of lineBoxes) box.checked = ticked.has(k)
      count.textContent = `${[...ticked].length} of ${all.length} changed lines`
    }

    diff.hunks.forEach((h, hi) => {
      const keys = h.lines.flatMap((l, li) => (l.kind === ' ' ? [] : [`${hi}:${li}`]))
      const wholeOnly = h.lines.some((l) => l.noEol) // see buildPatch: such a hunk cannot be split
      const section = el('div', 'partial-hunk')
      section.dataset['hunk'] = String(hi)
      const hh = el('label', 'partial-hunk-head')
      const hb = el('input')
      hb.type = 'checkbox'
      hb.className = 'partial-hunk-box'
      hb.onchange = () => {
        for (const k of keys) {
          if (hb.checked) ticked.add(k)
          else ticked.delete(k)
        }
        sync()
      }
      hunkBoxes.push(hb)
      hh.append(hb, el('span', 'partial-hunk-text', `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.context}`))
      if (wholeOnly) hh.append(el('span', 'partial-note', 'whole hunk only (end of file without a newline)'))
      section.append(hh)
      h.lines.forEach((l, li) => {
        const row = el('div', `partial-line ${l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : 'ctx'}`)
        if (l.kind === ' ') {
          row.append(el('span', 'partial-pad'))
        } else {
          const k = `${hi}:${li}`
          const lb = el('input')
          lb.type = 'checkbox'
          lb.className = 'partial-line-box'
          lb.disabled = wholeOnly
          lb.onchange = () => {
            if (lb.checked) ticked.add(k)
            else ticked.delete(k)
            sync()
          }
          lineBoxes.set(k, lb)
          row.append(lb)
        }
        row.append(el('span', 'partial-sign', l.kind === ' ' ? ' ' : l.kind), el('span', 'partial-text', l.text || ' '))
        section.append(row)
      })
      body.append(section)
    })

    const finish = (result: PartialChoice | null): void => {
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
    allBtn.onclick = () => {
      for (const k of all) ticked.add(k)
      sync()
    }
    noneBtn.onclick = () => {
      ticked.clear()
      sync()
    }
    cancel.onclick = () => finish(null)
    overlay.onmousedown = (e) => {
      if (e.target === overlay) finish(null)
    }
    done.onclick = () =>
      finish({
        fingerprint: diff.fingerprint,
        selected: diff.hunks.map((h, hi) => h.lines.flatMap((l, li) => (l.kind !== ' ' && ticked.has(`${hi}:${li}`) ? [li] : []))),
        picked: ticked.size,
        total: all.length
      })

    document.body.append(overlay)
    sync()
    done.focus()
  })
}
