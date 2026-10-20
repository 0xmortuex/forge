// Folding an import graph by folder. Kept apart from depgraph.ts so the renderer can use it without Node's path module.

export interface Graph {
  /** Paths relative to the project, with "/" separators. */
  files: string[]
  /** Indexes into `files`: `from` imports `to`. */
  edges: { from: number; to: number }[]
}

/** The same graph with each file replaced by its folder (to `depth` levels); edges inside a folder disappear and the rest are counted. */
export function foldByFolder(graph: Graph, depth: number): { folders: string[]; edges: { from: number; to: number; count: number }[] } {
  const folderOf = (file: string): string => {
    const parts = file.split('/')
    parts.pop()
    return parts.slice(0, depth).join('/') || '.'
  }
  const folders = [...new Set(graph.files.map(folderOf))].sort()
  const at = new Map(folders.map((f, i) => [f, i]))
  const counts = new Map<string, { from: number; to: number; count: number }>()
  for (const e of graph.edges) {
    const from = at.get(folderOf(graph.files[e.from] as string)) as number
    const to = at.get(folderOf(graph.files[e.to] as string)) as number
    if (from === to) continue
    const key = `${from}>${to}`
    const c = counts.get(key)
    if (c) c.count++
    else counts.set(key, { from, to, count: 1 })
  }
  return { folders, edges: [...counts.values()] }
}
