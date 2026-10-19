// .editorconfig support: indentation when a file opens, and trailing whitespace / final newline / line endings when it
// is saved. The settings come from the .editorconfig files between the file and the project root (nearest wins), and
// `root = true` stops the search.

export interface EditorConfigSettings {
  indentStyle?: 'space' | 'tab'
  indentSize?: number
  endOfLine?: 'lf' | 'crlf'
  trimTrailingWhitespace?: boolean
  insertFinalNewline?: boolean
}

interface Section {
  pattern: string
  props: Record<string, string>
}

const sep = (p: string): string => (p.includes('\\') ? '\\' : '/')
const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')
const norm = (p: string): string => p.replace(/\\/g, '/')

/** Reads the text of an .editorconfig: its sections, and whether it says root = true. */
export function parseEditorConfig(text: string): { root: boolean; sections: Section[] } {
  let root = false
  const sections: Section[] = []
  let current: Section | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const sec = /^\[(.+)\]$/.exec(line)
    if (sec) {
      current = { pattern: sec[1]!, props: {} }
      sections.push(current)
      continue
    }
    const kv = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]!.toLowerCase()
    const value = kv[2]!.trim().toLowerCase()
    if (current) current.props[key] = value
    else if (key === 'root') root = value === 'true'
  }
  return { root, sections }
}

/** EditorConfig globs: * (not /), ** (anything), ? , {a,b}, {1..3}, [abc]. */
export function globToRegExp(glob: string): RegExp {
  let out = ''
  let braces = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i++
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else if (c === '{') {
      const close = glob.indexOf('}', i)
      const body = close > i ? glob.slice(i + 1, close) : ''
      const range = /^(-?\d+)\.\.(-?\d+)$/.exec(body)
      if (range) {
        const [a, b] = [Number(range[1]), Number(range[2])]
        out += `(?:${Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => String(Math.min(a, b) + k)).join('|')})`
        i = close
      } else if (close > i && body.includes(',')) {
        out += '(?:'
        braces++
      } else out += '\\{'
    } else if (c === ',' && braces > 0) out += '|'
    else if (c === '}' && braces > 0) {
      out += ')'
      braces--
    } else if (c === '[') {
      const close = glob.indexOf(']', i)
      if (close > i) {
        out += glob.slice(i, close + 1).replace(/^\[!/, '[^')
        i = close
      } else out += '\\['
    } else out += c.replace(/[.+^$()|\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

/** Does `rel` (path relative to the .editorconfig's folder, with /) match the section's pattern? */
export function matches(pattern: string, rel: string): boolean {
  // A pattern with no slash matches the file name anywhere; one with a slash is relative to the .editorconfig.
  if (!pattern.includes('/')) return globToRegExp(pattern).test(rel.split('/').pop() ?? rel)
  return globToRegExp(pattern.replace(/^\//, '')).test(rel)
}

export interface EditorConfig {
  /** The settings that apply to a file. */
  resolve: (path: string) => Promise<EditorConfigSettings>
  /** Forget what was read (an .editorconfig changed). */
  clear: () => void
}

export function initEditorConfig(deps: {
  getRoot: () => string | null
  exists: (p: string) => Promise<boolean>
  readFile: (p: string) => Promise<string>
}): EditorConfig {
  const cache = new Map<string, ReturnType<typeof parseEditorConfig> | null>()

  async function load(dir: string): Promise<ReturnType<typeof parseEditorConfig> | null> {
    if (cache.has(dir)) return cache.get(dir) ?? null
    const file = `${dir}${sep(dir)}.editorconfig`
    const parsed = (await deps.exists(file)) ? parseEditorConfig(await deps.readFile(file)) : null
    cache.set(dir, parsed)
    return parsed
  }

  return {
    clear: () => cache.clear(),
    async resolve(path) {
      const root = deps.getRoot()
      const props: Record<string, string> = {}
      // From the file's folder up; files nearer the file win, so apply the farthest first.
      const chain: { dir: string; cfg: NonNullable<Awaited<ReturnType<typeof load>>> }[] = []
      let dir = dirOf(path)
      for (let guard = 0; guard < 40; guard++) {
        const cfg = await load(dir)
        if (cfg) {
          chain.push({ dir, cfg })
          if (cfg.root) break
        }
        if (root && norm(dir).toLowerCase() === norm(root).toLowerCase()) break
        const up = dirOf(dir)
        if (up === dir || !up) break
        dir = up
      }
      for (const { dir: d, cfg } of chain.reverse()) {
        const rel = norm(path).slice(norm(d).length + 1)
        for (const sec of cfg.sections) if (matches(sec.pattern, rel)) Object.assign(props, sec.props)
      }
      const out: EditorConfigSettings = {}
      const style = props['indent_style']
      if (style === 'space' || style === 'tab') out.indentStyle = style
      const size = props['indent_size'] === 'tab' ? props['tab_width'] : (props['indent_size'] ?? props['tab_width'])
      if (size && /^\d+$/.test(size)) out.indentSize = Number(size)
      if (props['end_of_line'] === 'lf' || props['end_of_line'] === 'crlf') out.endOfLine = props['end_of_line']
      if (props['trim_trailing_whitespace'] === 'true') out.trimTrailingWhitespace = true
      if (props['insert_final_newline'] === 'true') out.insertFinalNewline = true
      return out
    }
  }
}

/** Applies the on-save settings to a text. */
export function formatForSave(text: string, s: EditorConfigSettings): string {
  let out = text
  const nl = s.endOfLine === 'crlf' ? '\r\n' : s.endOfLine === 'lf' ? '\n' : out.includes('\r\n') ? '\r\n' : '\n'
  if (s.trimTrailingWhitespace) out = out.replace(/[ \t]+(?=\r?\n|$)/g, '')
  if (s.insertFinalNewline && out !== '' && !/\r?\n$/.test(out)) out += nl
  if (s.endOfLine) out = out.replace(/\r?\n/g, nl)
  return out
}
