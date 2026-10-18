import { settings } from './settings'

export type ToastKind = 'ok' | 'err' | 'warn' | 'info'

const ICONS: Record<ToastKind, string> = { ok: '✓', err: '!', warn: '!', info: 'i' }
const MAX_TOASTS = 4

/** A small message that slides in at the bottom right and leaves by itself. Click to dismiss. */
export function toast(message: string, kind: ToastKind = 'info', ms = kind === 'err' ? 7000 : 3800): void {
  const host = document.getElementById('toasts')
  if (!host) throw new Error('Missing #toasts')
  while (host.children.length >= MAX_TOASTS) host.firstElementChild?.remove()

  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.style.setProperty('--toast-ms', `${ms}ms`)
  const ico = document.createElement('span')
  ico.className = 'ico'
  ico.textContent = ICONS[kind]
  const msg = document.createElement('span')
  msg.className = 'msg'
  msg.textContent = message
  const bar = document.createElement('span')
  bar.className = 'bar'
  el.append(ico, msg, bar)
  host.append(el)

  let gone = false
  const leave = (): void => {
    if (gone) return
    gone = true
    el.classList.add('leaving')
    // Wait for the slide-out; with animations off there is no animationend, so fall back to a timer.
    const done = (): void => el.remove()
    el.addEventListener('animationend', done, { once: true })
    window.setTimeout(done, 400)
  }
  el.onclick = leave
  window.setTimeout(leave, ms)
}

/** Whether a message should pop up as a toast, per the Notifications setting. */
const IMPORTANT = /^(Saved|Committed|Pushed|Pulled|Renamed|Created|Moved|Reverted|Unstaged|Stashed|Applied|Dropped|Switched|Process finished|Debugging|Running)/

export function shouldToast(message: string, isError: boolean): ToastKind | null {
  const mode = settings.get<string>('notifications')
  if (mode === 'off') return null
  if (isError) return 'err'
  if (mode === 'errors') return null
  if (mode === 'all') return 'info'
  return IMPORTANT.test(message) ? 'ok' : null
}

/** Material-style ripple on buttons: a circle grows from where you pressed. */
export function initRipples(): void {
  document.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('no-anim')) return
    const target = (e.target as Element | null)?.closest<HTMLElement>('.icon-btn, .tw-btn, .widget, .btn, .btn-primary, #commit-btn, .btab, .ttab')
    if (!target || (target as HTMLButtonElement).disabled) return
    const rect = target.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height) * 2
    const dot = document.createElement('span')
    dot.className = 'ripple'
    dot.style.width = dot.style.height = `${size}px`
    dot.style.left = `${e.clientX - rect.left - size / 2}px`
    dot.style.top = `${e.clientY - rect.top - size / 2}px`
    target.append(dot)
    dot.addEventListener('animationend', () => dot.remove(), { once: true })
    window.setTimeout(() => dot.remove(), 900) // safety if animationend never fires
  })
}
