import DOMPurify from 'dompurify'
import { marked } from 'marked'

// The Preview window: the Markdown file in the editor, rendered, and updated as you type. The HTML is sanitized (a
// Markdown file can contain raw HTML), relative images are loaded from disk, and links open where you would expect:
// other Markdown files in the editor, web links in the browser, #anchors by scrolling.

export interface PreviewDeps {
  /** The window's own root element. */
  root: HTMLElement
  /** The Markdown file in the editor (path and its current text), or null. */
  current: () => { path: string; text: string } | null
  openFile: (path: string) => Promise<void>
  /** Whether the window is on screen; nothing is rendered while it is hidden. */
  isVisible: () => boolean
  report: (msg: string, isError?: boolean) => void
}

export interface Preview {
  refresh: () => Promise<void>
}

const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')
const slug = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')

export function initPreview(d: PreviewDeps): Preview {
  const body = document.createElement('div')
  body.className = 'md-body'
  body.id = 'md-body'
  d.root.replaceChildren(body)
  let seq = 0

  async function refresh(): Promise<void> {
    const mine = ++seq
    const cur = d.current()
    if (!cur) {
      body.replaceChildren(Object.assign(document.createElement('div'), { className: 'hint', textContent: 'Open a Markdown file (.md) to see its preview.' }))
      return
    }
    const html = DOMPurify.sanitize(marked.parse(cur.text, { gfm: true, async: false }) as string)
    if (mine !== seq) return
    body.innerHTML = html
    const used = new Map<string, number>()
    body.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
      const base = slug(h.textContent ?? '')
      const n = used.get(base) ?? 0
      used.set(base, n + 1)
      h.id = n ? `${base}-${n}` : base
    })
    const baseDir = dirOf(cur.path)
    // Images next to the file: the page may only load data: URLs, so read them from disk.
    for (const img of body.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? ''
      if (!src || /^(data:|https?:|\/\/)/i.test(src)) continue
      const abs = `${baseDir}${baseDir.includes('\\') ? '\\' : '/'}${decodeURI(src).replace(/^\.[\\/]/, '')}`
      img.removeAttribute('src')
      window.forge
        .readDataUrl(abs)
        .then((r) => {
          if (mine === seq) img.setAttribute('src', r.url)
        })
        .catch((err: unknown) => {
          img.setAttribute('alt', `${img.getAttribute('alt') ?? ''} (could not load: ${err instanceof Error ? err.message : String(err)})`)
        })
    }
    for (const a of body.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') ?? ''
      a.addEventListener('click', (e) => {
        e.preventDefault()
        if (href.startsWith('#')) {
          body.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth' })
        } else if (/^(https?:|mailto:)/i.test(href)) {
          window.forge.openExternal(href).catch((err: unknown) => d.report(`Open link: ${err instanceof Error ? err.message : String(err)}`, true))
        } else {
          const target = `${baseDir}${baseDir.includes('\\') ? '\\' : '/'}${decodeURI(href.split('#')[0] ?? '')}`
          d.openFile(target).catch(() => undefined) // reported by the opener
        }
      })
    }
  }

  return { refresh }
}
