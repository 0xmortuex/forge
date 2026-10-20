import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ipcMain } from 'electron'
import { buildGraph, findCycles, type Graph } from './depgraph'
import { walkFiles } from './walk'

const SOURCE = /\.(m?[jt]sx?|cjs|cts|vue|svelte|py|css|scss|sass|less|c|h|cc|cpp|hpp)$/i
const MAX_FILES = 4000

export interface DepsResult {
  graph: Graph
  /** Groups of files (indexes into graph.files) that import each other in a circle, largest first. */
  cycles: number[][]
  /** Set when the project had more source files than are analysed. */
  truncated: boolean
}

export async function analyseDependencies(root: string): Promise<DepsResult> {
  const files: { path: string; text: string }[] = []
  let truncated = false
  await walkFiles(root, async (file) => {
    if (!SOURCE.test(file)) return
    if (files.length >= MAX_FILES) {
      truncated = true
      return
    }
    if ((await stat(file)).size > 1024 * 1024) return
    files.push({ path: file, text: await readFile(file, 'utf8').catch(() => '') })
  })
  const graph = buildGraph(resolve(root), files)
  return { graph, cycles: findCycles(graph), truncated }
}

export function registerDeps(): void {
  ipcMain.handle('deps:analyse', (_e, root: string) => analyseDependencies(root))
}
