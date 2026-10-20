import { dirname, resolve, sep } from 'node:path'

// Safe Delete: before a file or folder goes to the Recycle Bin, find the other files that point at it (imports, includes,
// stylesheet imports, HTML src/href, Markdown links) so the user hears what will break. Pure text matching on relative
// references; it does not run a language server, so a reference built at run time is not found.

export interface Reference {
  /** 1-based. */
  line: number
  /** The line, trimmed. */
  text: string
}

const key = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)

/** The relative specifiers on a line, with whether the language writes them without "./" (C includes, HTML, Markdown...). */
export function specifiers(line: string): string[] {
  const out: string[] = []
  const grab = (re: RegExp, filter?: (s: string) => boolean): void => {
    for (const m of line.matchAll(re)) {
      const s = m[1]
      if (s && (!filter || filter(s))) out.push(s)
    }
  }
  const relative = (s: string): boolean => s.startsWith('.')
  const local = (s: string): boolean => !/^([a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(s) // not a URL, an anchor or an absolute path
  // JavaScript / TypeScript: only relative specifiers (a bare name is a package).
  grab(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g, relative)
  grab(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g, relative)
  // CSS / Sass / Less
  grab(/@import\s+(?:url\()?['"]([^'"]+)['"]/g, local)
  grab(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g, local)
  // C / C++
  grab(/#\s*include\s+"([^"]+)"/g, local)
  // HTML
  grab(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g, local)
  // Markdown links and images
  grab(/\]\(\s*<?([^)\s>]+)/g, local)
  // Python: "from .mod import x", "from ..pkg.mod import x", "from . import mod"
  const py = /^\s*from\s+(\.+)([\w.]*)\s+import\s+([\w, ]+)/.exec(line)
  if (py) {
    const up = '../'.repeat(Math.max(0, (py[1] ?? '').length - 1)) || './'
    const mod = (py[2] ?? '').replace(/\./g, '/')
    if (mod) out.push(up + mod)
    else for (const name of (py[3] ?? '').split(',')) if (name.trim()) out.push(up + name.trim())
  }
  return out
}

/** Whether `spec`, written in `fromFile`, points at `target` (a file, or a folder when `isDir`). */
export function pointsAt(spec: string, fromFile: string, target: string, isDir: boolean): boolean {
  const clean = decodeURI(spec.split(/[?#]/)[0] ?? '')
  if (!clean) return false
  const resolved = key(resolve(dirname(fromFile), clean))
  const t = key(resolve(target))
  if (resolved === t) return true
  if (isDir) return resolved.startsWith(t + sep)
  // "./x" for x.ts / x.js, and "./dir" for dir/index.ts
  const dot = t.lastIndexOf('.')
  if (dot > t.lastIndexOf(sep) && resolved === t.slice(0, dot)) return true
  return /^index\.[^.]+$/.test(t.slice(t.lastIndexOf(sep) + 1)) && resolved === dirname(t)
}

/** The lines of `text` (the contents of `fromFile`) that refer to `target`. */
export function referencesTo(target: string, isDir: boolean, fromFile: string, text: string): Reference[] {
  const found: Reference[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.length > 2000) continue // minified or generated: not worth scanning
    if (specifiers(line).some((s) => pointsAt(s, fromFile, target, isDir))) found.push({ line: i + 1, text: line.trim().slice(0, 160) })
  }
  return found
}
