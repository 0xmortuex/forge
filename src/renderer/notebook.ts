// Jupyter notebooks (.ipynb) for the notebook viewer: JSON in, a flat list of cells with their outputs out. Pure, no DOM.

export type NotebookOutput =
  | { kind: 'text'; text: string; error?: boolean }
  | { kind: 'image'; url: string }
  | { kind: 'html'; html: string }

export interface NotebookCell {
  kind: 'markdown' | 'code' | 'raw'
  source: string
  /** The execution counter of a code cell that has run. */
  count?: number
  outputs: NotebookOutput[]
}

export interface Notebook {
  language: string
  cells: NotebookCell[]
}

/** A notebook stores text as a string or as a list of lines. */
const joined = (v: unknown): string => (Array.isArray(v) ? v.map(String).join('') : typeof v === 'string' ? v : '')

// Terminal colour codes in tracebacks: ESC [ ... m
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')

function outputOf(raw: unknown): NotebookOutput[] {
  if (typeof raw !== 'object' || raw === null) return []
  const o = raw as Record<string, unknown>
  const type = o['output_type']
  if (type === 'stream') return [{ kind: 'text', text: joined(o['text']) }]
  if (type === 'error') {
    const trace = Array.isArray(o['traceback']) ? o['traceback'].map(String).join('\n') : `${String(o['ename'] ?? 'Error')}: ${String(o['evalue'] ?? '')}`
    return [{ kind: 'text', text: trace.replace(ANSI, ''), error: true }]
  }
  if (type === 'display_data' || type === 'execute_result') {
    const data = (typeof o['data'] === 'object' && o['data'] !== null ? o['data'] : {}) as Record<string, unknown>
    for (const mime of ['image/png', 'image/jpeg']) {
      const img = joined(data[mime]).replace(/\s+/g, '')
      if (img) return [{ kind: 'image', url: `data:${mime};base64,${img}` }]
    }
    if (data['text/html'] !== undefined) return [{ kind: 'html', html: joined(data['text/html']) }]
    if (data['text/plain'] !== undefined) return [{ kind: 'text', text: joined(data['text/plain']) }]
  }
  return []
}

/** Throws a readable error when the text is not a notebook. */
export function parseNotebook(text: string): Notebook {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(`Not a notebook: ${(err as Error).message}`)
  }
  const nb = json as { cells?: unknown; metadata?: { language_info?: { name?: string }; kernelspec?: { language?: string } } }
  if (typeof json !== 'object' || json === null || !Array.isArray(nb.cells)) {
    throw new Error('Not a notebook: it has no "cells" list (only nbformat 4 is supported)')
  }
  const language = nb.metadata?.language_info?.name ?? nb.metadata?.kernelspec?.language ?? 'python'
  const cells: NotebookCell[] = []
  for (const c of nb.cells) {
    if (typeof c !== 'object' || c === null) continue
    const cell = c as Record<string, unknown>
    const kind = cell['cell_type'] === 'markdown' ? 'markdown' : cell['cell_type'] === 'code' ? 'code' : 'raw'
    const count = typeof cell['execution_count'] === 'number' ? cell['execution_count'] : undefined
    cells.push({
      kind,
      source: joined(cell['source']),
      ...(count !== undefined ? { count } : {}),
      outputs: Array.isArray(cell['outputs']) ? cell['outputs'].flatMap(outputOf) : []
    })
  }
  return { language, cells }
}
