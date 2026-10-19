// Styled tooltips that replace the browser's plain ones. Any element with a title="..." gets one; a trailing
// "(Ctrl+Shift+P)" in the text is drawn as key caps. The native tooltip is suppressed by moving the title to data-tip.

const DELAY = 450
const SHORTCUT = /^(.*?)\s*\(((?:Ctrl|Alt|Shift|Cmd|F\d+|Enter|Esc)[^()]*)\)$/

export function initTooltips(): void {
  const tip = document.createElement('div')
  tip.id = 'tooltip'
  tip.hidden = true
  document.body.append(tip)
  let timer: number | undefined
  let current: HTMLElement | null = null

  const hide = (): void => {
    window.clearTimeout(timer)
    tip.hidden = true
    current = null
  }

  function show(el: HTMLElement, text: string): void {
    const m = SHORTCUT.exec(text)
    tip.replaceChildren()
    const label = document.createElement('span')
    label.textContent = m ? m[1]! : text
    tip.append(label)
    if (m) {
      const keys = document.createElement('span')
      keys.className = 'tip-keys'
      for (const k of m[2]!.split(/\s*\+\s*|\s+/).filter(Boolean)) {
        const kbd = document.createElement('kbd')
        kbd.textContent = k
        keys.append(kbd)
      }
      tip.append(keys)
    }
    tip.hidden = false
    const box = el.getBoundingClientRect()
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    let left: number
    let top: number
    const side = el.closest('#stripe') ? 'right' : el.closest('#stripe-right') ? 'left' : 'below'
    if (side === 'below') {
      left = Math.max(6, Math.min(box.left + box.width / 2 - w / 2, window.innerWidth - w - 6))
      // Below the element, unless that runs off the window.
      top = box.bottom + 8 + h > window.innerHeight ? box.top - h - 8 : box.bottom + 8
    } else {
      // Stripe buttons: beside them, so the neighbouring buttons stay visible.
      left = side === 'right' ? box.right + 8 : box.left - w - 8
      top = box.top + box.height / 2 - h / 2
    }
    tip.style.left = `${left}px`
    tip.style.top = `${Math.max(6, Math.min(top, window.innerHeight - h - 6))}px`
  }

  document.addEventListener('mouseover', (e) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[title], [data-tip]')
    if (!el || el === current) return
    hide()
    const text = el.getAttribute('title') || el.dataset['tip']
    if (!text) return
    if (el.hasAttribute('title')) {
      el.dataset['tip'] = text
      el.removeAttribute('title') // takes over from the native tooltip
    }
    current = el
    timer = window.setTimeout(() => show(el, text), DELAY)
  })
  document.addEventListener('mouseout', (e) => {
    // Only leaving the element itself counts; a stray mouseout from elsewhere (e.g. after the layout shifted under a
    // resting pointer) must not hide a tooltip that is about to show.
    if (current && current.contains(e.target as Node | null) && !current.contains(e.relatedTarget as Node | null)) hide()
  })
  window.addEventListener('mousedown', hide, true)
  window.addEventListener('keydown', hide, true)
  window.addEventListener('blur', hide)
}
