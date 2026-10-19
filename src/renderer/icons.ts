const svg = (body: string, size = 16): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const icons = {
  project: svg('<rect x="2" y="3" width="12" height="8.5" rx="1.5"/><path d="M5.5 14h5M8 11.5V14"/>', 18),
  output: svg('<path d="M3 4h10M3 8h10M3 12h6"/>', 18),
  terminal: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M4.8 6l2 2-2 2M8.5 10.5h3"/>', 18),
  search: svg('<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L13.5 13.5"/>', 18),
  chevronRight: svg('<path d="M6 4l4 4-4 4"/>', 12),
  chevronDown: svg('<path d="M4 6l4 4 4-4"/>', 12),
  branch: svg('<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="6" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.6c0 2.4-3 2.4-7 3.2"/>', 14),
  commit: svg('<circle cx="8" cy="8" r="2.6"/><path d="M1.5 8h3.9M10.6 8h3.9"/>', 18),
  refresh: svg('<path d="M13 8a5 5 0 11-1.6-3.7M13 2.5v2.6h-2.6"/>', 14),
  play: svg('<path d="M5 3.2v9.6a.4.4 0 00.6.35l7.6-4.8a.4.4 0 000-.7L5.6 2.85A.4.4 0 005 3.2z" fill="currentColor" fill-opacity=".25"/>', 18),
  bug: svg('<ellipse cx="8" cy="9.2" rx="3" ry="3.8"/><path d="M6.2 5.6a2 2 0 013.6 0M2.5 8.5h2.6M10.9 8.5h2.6M3.2 12.2l2-1.2M12.8 12.2l-2-1.2M3.4 4.8l2 1.2M12.6 4.8l-2 1.2"/>', 18),
  stop: svg('<rect x="3.8" y="3.8" width="8.4" height="8.4" rx="1.4" fill="currentColor" fill-opacity=".25"/>', 18),
  resume: svg('<path d="M3.5 3v10"/><path d="M7 3.6v8.8a.4.4 0 00.6.35l6.2-4.4a.4.4 0 000-.7L7.6 3.25A.4.4 0 007 3.6z" fill="currentColor" fill-opacity=".25"/>', 16),
  stepOver: svg('<path d="M2.5 9.5C2.5 5 8 3.5 13 6.5M13 3v3.5h-3.5"/><circle cx="8" cy="12.5" r="1.3"/>', 16),
  stepInto: svg('<path d="M8 2.5v7M5 6.8l3 3 3-3"/><circle cx="8" cy="12.8" r="1.3"/>', 16),
  stepOut: svg('<path d="M8 9.5v-7M5 5.2l3-3 3 3"/><circle cx="8" cy="12.8" r="1.3"/>', 16),
  pull: svg('<path d="M8 2.5v8M5 7.8l3 3 3-3M3 13.5h10"/>', 14),
  push: svg('<path d="M8 10.5v-8M5 5.2l3-3 3 3M3 13.5h10"/>', 14),
  stash: svg('<path d="M2.5 6h11v6.5a1 1 0 01-1 1h-9a1 1 0 01-1-1zM4 3.5h8M5.5 1.5h5"/>', 14),
  gear: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2"/>', 18),
  command: svg('<path d="M5.5 5.5V4a1.5 1.5 0 10-1.5 1.5zM5.5 5.5h5M10.5 5.5V4A1.5 1.5 0 1112 5.5zM10.5 5.5v5M10.5 10.5H12a1.5 1.5 0 11-1.5 1.5zM10.5 10.5h-5M5.5 10.5V12A1.5 1.5 0 114 10.5zM5.5 10.5v-5"/>', 18),
  minus: svg('<path d="M3.5 8h9"/>', 14),
  structure: svg('<path d="M3 3h5M5 6.5h5M5 10h5M7 13.5h6"/><path d="M3 3v7a1 1 0 001 1h1M5 6.5V10"/>', 18),
  problems: svg('<path d="M8 2.2l6 10.6a.5.5 0 01-.45.7H2.45a.5.5 0 01-.45-.7z"/><path d="M8 6.4v3.2M8 11.4v.1"/>', 18),
  sort: svg('<path d="M4 3v10M2 11l2 2 2-2M9 4h5M9 8h3.5M9 12h2"/>', 14),
  expandAll: svg('<path d="M4.5 6.5L8 3l3.5 3.5M4.5 9.5L8 13l3.5-3.5"/>', 14),
  collapseAll: svg('<path d="M4.5 3.5L8 7l3.5-3.5M4.5 12.5L8 9l3.5 3.5"/>', 14),
  locate: svg('<circle cx="8" cy="8" r="3.2"/><circle cx="8" cy="8" r=".6" fill="currentColor"/><path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2"/>', 14),
  newFile: svg('<path d="M4 2h5l3 3v8.5a.5.5 0 01-.5.5h-7.5a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5zM8 7.5v4M6 9.5h4"/>', 14),
  close: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>', 12),
  folder: svg('<path d="M2 4.5A1.5 1.5 0 013.5 3h2.8l1.4 1.5h4.8A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5z" fill="currentColor" fill-opacity=".18"/>'),
  file: svg('<path d="M4 2h5l3 3v8.5a.5.5 0 01-.5.5h-7.5a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5z"/><path d="M9 2v3h3"/>')
}

const EXT_COLORS: Record<string, string> = {
  ts: '#4fc3f7', tsx: '#4fc3f7', js: '#ffd54f', jsx: '#ffd54f', mjs: '#ffd54f', cjs: '#ffd54f', json: '#ffb74d',
  css: '#7e8bff', scss: '#f06292', html: '#ff8a65', md: '#90caf9', py: '#81c784', c: '#64b5f6',
  h: '#9575cd', cpp: '#64b5f6', rs: '#ff8a65', mx: '#c792ea', yaml: '#ef9a9a', yml: '#ef9a9a',
  toml: '#ef9a9a', lock: '#78909c', gitignore: '#78909c', sh: '#a5d6a7', txt: '#90a4ae', svg: '#ffb74d', png: '#ce93d8'
}

// The letters drawn on a file's badge.
const EXT_LABEL: Record<string, string> = {
  ts: 'TS', tsx: 'TSX', js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS', json: '{}', css: 'CSS', scss: 'SC', html: '<>', md: 'MD',
  py: 'PY', c: 'C', h: 'H', cpp: 'C+', rs: 'RS', mx: 'MX', yaml: 'YM', yml: 'YM', toml: 'TM', lock: 'LK',
  gitignore: 'GI', sh: 'SH', txt: 'TXT', svg: 'SVG', png: 'IMG'
}

const extOf = (name: string): string => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '')

/** The accent color for a file type, if it has one. */
export function fileColor(name: string): string | undefined {
  return EXT_COLORS[extOf(name)]
}

/** A small colored badge with the file type's letters; an outlined page for types it doesn't know. */
export function fileIcon(name: string): string {
  const ext = extOf(name)
  const label = EXT_LABEL[ext]
  if (!label) return `<span class="ficon" style="color:#78909c">${icons.file}</span>`
  const color = EXT_COLORS[ext] ?? '#78909c'
  const size = label.length > 2 ? ' tiny' : ''
  // The letters are drawn by CSS (data-l), so they are not part of the row's text.
  return `<span class="ficon fbadge${size}" data-l="${label.replace('<', '&lt;').replace('>', '&gt;')}" style="--c:${color}"></span>`
}

const FOLDER_COLORS: Record<string, string> = {
  src: 'var(--accent)', lib: 'var(--accent)', app: 'var(--accent)', test: '#81c784', tests: '#81c784', __tests__: '#81c784',
  docs: '#64b5f6', doc: '#64b5f6', node_modules: '#78909c', '.git': '#f4511e', '.github': '#90a4ae', dist: '#ffb74d',
  out: '#ffb74d', build: '#ffb74d', public: '#ba68c8', assets: '#ba68c8', examples: '#4dd0e1'
}
const FOLDER_OPEN = '<path d="M2 5A1.5 1.5 0 013.5 3.5h2.8L7.7 5h4.8A1.5 1.5 0 0114 6.5V7M2.6 13h9.7a1.2 1.2 0 001.15-.85l1.1-3.6A.6.6 0 0014 7.8H4.7a1.2 1.2 0 00-1.15.85L2.2 13" fill="currentColor" fill-opacity=".18"/>'

/** A folder; special names (src, tests, node_modules ...) get their own color, and an open folder is drawn open. */
export function folderIcon(name = '', open = false): string {
  const color = FOLDER_COLORS[name] ?? 'var(--folder)'
  return `<span class="ficon" style="color:${color}">${open ? svg(FOLDER_OPEN) : icons.folder}</span>`
}
