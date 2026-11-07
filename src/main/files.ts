import { realpathSync } from 'node:fs'
import { access, cp, mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, sep } from 'node:path'
import { assertEncoding, decode, detectEncoding, encode } from './encoding'
import { referencesTo, type Reference } from './safedelete'
import { replaceInFiles, searchProject, type SearchOptions } from './search'
import { walkFiles } from './walk'

// The project's files: reading, writing, searching, creating and renaming. These belong to the backend because the files
// live where the backend runs. (Showing a file in the file manager, the Recycle Bin and the folder picker act on this
// computer's screen and stay with the window, in main/index.ts.)

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

export interface ReferenceHits {
  hits: (Reference & { file: string })[]
  files: number
  truncated: boolean
}

const assertMissing = async (path: string): Promise<void> => {
  const exists = await access(path).then(() => true, () => false)
  if (exists) throw new Error(`Already exists: ${path}`)
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif'
}
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** Files whose text can refer to other files. */
const SCANNED = /\.(m?[jt]sx?|cjs|cts|vue|svelte|py|css|scss|sass|less|html?|md|mdx|c|h|cc|cpp|hpp|cs|java|go|rs|rb|php|json|ya?ml|toml|xml|svg)$/i

/** Provided as the "files" service (see platform). */
export class FilesService {
  async readDir(dir: string): Promise<DirEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .map((e) => ({ name: e.name, path: join(dir, e.name), isDir: e.isDirectory() }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  }

  async listFiles(root: string): Promise<string[]> {
    const files: string[] = []
    await walkFiles(root, (p) => void files.push(p))
    return files
  }

  search(root: string, query: string, options: SearchOptions = {}) {
    return searchProject(root, query, options)
  }

  replace(query: string, options: SearchOptions, replacement: string, paths: string[]) {
    return replaceInFiles(query, options, replacement, paths)
  }

  exists(path: string): Promise<boolean> {
    return access(path).then(() => true, () => false)
  }

  /** An image file as a data: URL (the page may not load files directly). */
  async readDataUrl(path: string): Promise<{ url: string; bytes: number }> {
    const mime = MIME[extname(path).slice(1).toLowerCase()]
    if (!mime) throw new Error(`Not an image type Forge can show: ${extname(path) || path}`)
    const buf = await readFile(path)
    if (buf.length > MAX_IMAGE_BYTES) throw new Error(`${basename(path)} is too large to show (${Math.round(buf.length / 1048576)} MB)`)
    return { url: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length }
  }

  /** Copies a file or a folder (and everything in it). Never overwrites. */
  copy(from: string, to: string): Promise<void> {
    return cp(from, to, { recursive: true, errorOnExist: true, force: false })
  }

  createFile(path: string): Promise<void> {
    return writeFile(path, '', { flag: 'wx' })
  }

  async createDir(path: string): Promise<void> {
    await mkdir(path)
  }

  async rename(from: string, to: string): Promise<void> {
    await assertMissing(to) // fs.rename would silently overwrite
    await rename(from, to)
  }

  // The real path of a folder: aliases (symlinks, junctions, Windows 8.3 short names like RUNNER~1) resolved. Git,
  // debuggers and language servers all report real paths, so the project has to be addressed by one too.
  async realpath(path: string): Promise<string> {
    return realpathSync.native(path)
  }

  /** The other files in the project that refer to `path` (a file or folder): what a delete would break. */
  async references(root: string, target: string): Promise<ReferenceHits> {
    const isDir = (await stat(target)).isDirectory()
    const inside = (p: string): boolean => p === target || (isDir && p.startsWith(target + sep))
    const hits: (Reference & { file: string })[] = []
    const files = new Set<string>()
    let truncated = false
    await walkFiles(root, async (file) => {
      if (truncated || inside(file) || !SCANNED.test(file)) return
      const info = await stat(file)
      if (info.size > 1024 * 1024) return
      const text = await readFile(file, 'utf8').catch(() => '')
      for (const ref of referencesTo(target, isDir, file, text)) {
        if (hits.length >= 200) {
          truncated = true
          return
        }
        hits.push({ ...ref, file })
        files.add(file)
      }
    })
    return { hits, files: files.size, truncated }
  }

  readFile(path: string): Promise<string> {
    return readFile(path, 'utf8')
  }

  /** Reads a text file in the given encoding, or the one it appears to be in. */
  async readFileEnc(path: string, encoding?: string): Promise<{ text: string; encoding: string }> {
    const buf = await readFile(path)
    const enc = encoding ?? detectEncoding(buf)
    if (encoding) assertEncoding(encoding)
    return { text: decode(buf, enc), encoding: enc }
  }

  /** A slice of a file's raw bytes (for the hex viewer), and the file's size. */
  async readBytes(path: string, offset: number, length: number): Promise<{ data: Uint8Array; size: number }> {
    const handle = await open(path, 'r')
    try {
      const size = (await handle.stat()).size
      const buf = Buffer.alloc(Math.max(0, Math.min(length, size - offset)))
      await handle.read(buf, 0, buf.length, offset)
      return { data: new Uint8Array(buf), size }
    } finally {
      await handle.close()
    }
  }

  /** Writes text in the given encoding; text it cannot represent is an error and nothing is written. */
  writeFileEnc(path: string, content: string, encoding: string): Promise<void> {
    return writeFile(path, encode(content, encoding))
  }

  writeFile(path: string, content: string): Promise<void> {
    return writeFile(path, content, 'utf8')
  }
}

export type FilesApi = FilesService
