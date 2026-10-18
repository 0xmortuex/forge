const svg = (body: string, size = 16): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const icons = {
  project: svg('<rect x="2" y="3" width="12" height="8.5" rx="1.5"/><path d="M5.5 14h5M8 11.5V14"/>', 18),
  output: svg('<path d="M3 4h10M3 8h10M3 12h6"/>', 18),
  terminal: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M4.8 6l2 2-2 2M8.5 10.5h3"/>', 18),
  search: svg('<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L13.5 13.5"/>', 18),
  chevronRight: svg('<path d="M6 4l4 4-4 4"/>', 12),
  chevronDown: svg('<path d="M4 6l4 4 4-4"/>', 12),
  minus: svg('<path d="M3.5 8h9"/>', 14),
  close: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>', 12),
  folder: svg('<path d="M2 4.5A1.5 1.5 0 013.5 3h2.8l1.4 1.5h4.8A1.5 1.5 0 0114 6v5.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5z" fill="currentColor" fill-opacity=".18"/>'),
  file: svg('<path d="M4 2h5l3 3v8.5a.5.5 0 01-.5.5h-7.5a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5z"/><path d="M9 2v3h3"/>')
}

const EXT_COLORS: Record<string, string> = {
  ts: '#4fc3f7', tsx: '#4fc3f7', js: '#ffd54f', jsx: '#ffd54f', mjs: '#ffd54f', json: '#ffb74d',
  css: '#7e8bff', scss: '#f06292', html: '#ff8a65', md: '#90caf9', py: '#81c784', c: '#64b5f6',
  h: '#9575cd', cpp: '#64b5f6', rs: '#ff8a65', mx: '#c792ea', yaml: '#ef9a9a', yml: '#ef9a9a',
  toml: '#ef9a9a', lock: '#78909c', gitignore: '#78909c'
}

export function fileIcon(name: string): string {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  const color = EXT_COLORS[ext] ?? '#78909c'
  return `<span class="ficon" style="color:${color}">${icons.file}</span>`
}

export const folderIcon = `<span class="ficon" style="color:#80cbc4">${icons.folder}</span>`
