import { client } from '../shared/rpc'
import type { FileIndexApi } from '../main/platform/fileindex'
import type { SpellApi } from '../main/spell'

// Typed handles to backend services (see src/main/platform). Each call is one round trip to the main process.

export const fileIndex = client<FileIndexApi>('fileindex', (req) => window.forge.rpc(req))
export const spell = client<SpellApi>('spell', (req) => window.forge.rpc(req))
export const onBackendEvent = (cb: (topic: string, payload: unknown) => void): (() => void) => window.forge.onRpcEvent(cb)

// The backend indexes one project at a time. It is opened on first use (a snapshot makes that quick after the first
// time) and then kept current by the file watcher, so later calls are answered from memory.
let opened: { root: string; ready: Promise<unknown> } | null = null

/** Every file of the project, from the backend index. Rejects when the project can't be indexed (e.g. too many files). */
export async function indexedFiles(root: string): Promise<string[]> {
  if (opened?.root !== root) {
    const ready = fileIndex.open(root)
    opened = { root, ready }
    // A failed open must not stick: the next call tries again.
    ready.catch(() => {
      if (opened?.ready === ready) opened = null
    })
  }
  await opened.ready
  return fileIndex.list()
}
