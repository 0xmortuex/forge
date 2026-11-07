import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { FilesService } from '../main/files'
import type { GitService } from '../main/git'
import type { FileIndex } from '../main/platform/fileindex'

// Forge as a Model Context Protocol server (stdio, JSON-RPC 2.0): an external agent can search and read the open project
// through the same index and services the IDE uses. It is READ-ONLY on purpose - no tool writes a file or runs a command -
// and every path is confined to the project root.

export const SERVER_NAME = 'forge'
export const SERVER_VERSION = '0.2.0'
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAX_READ_BYTES = 200 * 1024
const MAX_RESULTS = 200

export interface Tool {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  run(args: Record<string, unknown>): Promise<string>
}

export interface Services {
  root: string
  index: FileIndex
  files: FilesService
  git: GitService
}

// ---------------------------------------------------------------- argument helpers (a tool's own errors become isError results)

const str = (args: Record<string, unknown>, key: string, required = true): string => {
  const v = args[key]
  if (v === undefined && !required) return ''
  if (typeof v !== 'string' || (required && !v.trim())) throw new Error(`"${key}" must be a non-empty string`)
  return v
}
const int = (args: Record<string, unknown>, key: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number => {
  const v = args[key]
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(`"${key}" must be a positive whole number`)
  return Math.min(v, max)
}

/**
 * Resolves `p` (relative to the root, or absolute) and refuses anything that ends up outside the project, including
 * through a symlink. The file need not exist yet for the lexical check; if it does, its real location is checked too.
 */
export async function confine(root: string, p: string): Promise<string> {
  const abs = resolve(root, p)
  const rel = relative(root, abs)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error(`"${p}" is outside the project`)
  let real: string
  try {
    real = await realpath(abs)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return abs
    throw err
  }
  const realRoot = await realpath(root)
  const realRel = relative(realRoot, real)
  if (realRel === '..' || realRel.startsWith('..' + sep) || isAbsolute(realRel)) throw new Error(`"${p}" leads outside the project`)
  return abs
}

const display = (root: string, abs: string): string => relative(root, abs).split(sep).join('/')

// ---------------------------------------------------------------- the tools

export function projectTools(s: Services): Tool[] {
  const { root } = s
  return [
    {
      name: 'find_files',
      description: 'Find files in the project by name (fuzzy: "mainwin" finds "MainWindow.ts"). Returns project-relative paths, best match first.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: `Default 50, at most ${MAX_RESULTS}` } }, required: ['query'] },
      run: async (a) => {
        const hits = s.index.query(str(a, 'query'), int(a, 'limit', 50, MAX_RESULTS))
        return hits.length ? hits.map((h) => display(root, h.path)).join('\n') : 'No file matches.'
      }
    },
    {
      name: 'search_text',
      description: 'Search the text of every project file (case-insensitive, at least 3 characters). Returns "path:line: text" lines. Binary and very large files are not searched.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: `Default 50, at most ${MAX_RESULTS}` } }, required: ['query'] },
      run: async (a) => {
        const hits = await s.index.searchText(str(a, 'query'), int(a, 'limit', 50, MAX_RESULTS))
        return hits.length ? hits.map((h) => `${display(root, h.path)}:${h.line}: ${h.text}`).join('\n') : 'No matches.'
      }
    },
    {
      name: 'read_file',
      description: `Read a text file of the project, with line numbers. Optionally only lines startLine..endLine (1-based). Output is cut at ${MAX_READ_BYTES / 1024} KB.`,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Project-relative path' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } },
        required: ['path']
      },
      run: async (a) => {
        const abs = await confine(root, str(a, 'path'))
        const info = await stat(abs)
        if (!info.isFile()) throw new Error(`"${str(a, 'path')}" is not a file`)
        const start = int(a, 'startLine', 1)
        const end = int(a, 'endLine', Number.MAX_SAFE_INTEGER)
        if (end < start) throw new Error('"endLine" must not be before "startLine"')
        const text = await readFile(abs, 'utf8')
        if (text.slice(0, 8192).includes('\0')) throw new Error(`"${str(a, 'path')}" is a binary file`)
        const lines = text.split(/\r?\n/)
        const out: string[] = []
        let bytes = 0
        for (let n = start; n <= Math.min(end, lines.length); n++) {
          const row = `${n}\t${lines[n - 1]}`
          bytes += Buffer.byteLength(row) + 1
          if (bytes > MAX_READ_BYTES) {
            out.push(`... cut at ${MAX_READ_BYTES / 1024} KB; continue with startLine ${n}`)
            break
          }
          out.push(row)
        }
        return out.length ? out.join('\n') : `The file has ${lines.length} lines; nothing at ${start}.`
      }
    },
    {
      name: 'list_directory',
      description: 'List a folder of the project (folders first, then files). Defaults to the project root.',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Project-relative folder, default "."' } } },
      run: async (a) => {
        const dir = await confine(root, str(a, 'path', false) || '.')
        const entries = await s.files.readDir(dir)
        return entries.length ? entries.map((e) => (e.isDir ? e.name + '/' : e.name)).join('\n') : '(empty)'
      }
    },
    {
      name: 'git_status',
      description: 'The git status of the project: branch, upstream, ahead/behind and changed files.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const st = await s.git.status(root)
        if (!st) return 'The project is not a git repository.'
        const head = `${st.detached ? 'detached at' : 'branch'} ${st.branch}${st.upstream ? ` (upstream ${st.upstream}, ahead ${st.ahead}, behind ${st.behind})` : ''}`
        return [head, ...(st.changes.length ? st.changes.map((c) => `${c.kind}\t${display(root, c.path)}`) : ['clean'])].join('\n')
      }
    },
    {
      name: 'git_log',
      description: 'Recent commits of the current branch, newest first.',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'Default 20, at most 100' } } },
      run: async (a) => {
        const commits = await s.git.log(root, { limit: int(a, 'limit', 20, 100) })
        return commits.length ? commits.map((c) => `${c.sha.slice(0, 8)} ${new Date(c.time * 1000).toISOString().slice(0, 10)} ${c.author}: ${c.subject}`).join('\n') : 'No commits.'
      }
    }
  ]
}

// ---------------------------------------------------------------- the protocol

type Id = string | number | null
interface Reply {
  jsonrpc: '2.0'
  id: Id
  result?: unknown
  error?: { code: number; message: string }
}

export class McpServer {
  constructor(private readonly tools: Tool[]) {}

  /** One incoming line. Returns the line to send back, or null when nothing is to be answered (notifications). */
  async handle(line: string): Promise<string | null> {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return this.fail(null, -32700, 'Parse error: the message is not valid JSON')
    }
    if (Array.isArray(msg)) return this.fail(null, -32600, 'Batches are not supported')
    if (typeof msg !== 'object' || msg === null || (msg as { jsonrpc?: unknown }).jsonrpc !== '2.0' || typeof (msg as { method?: unknown }).method !== 'string') {
      return this.fail(null, -32600, 'Invalid request: expected a JSON-RPC 2.0 request or notification')
    }
    const { id, method, params } = msg as { id?: Id; method: string; params?: Record<string, unknown> }
    if (id === undefined) return null // a notification (e.g. notifications/initialized): no answer, even if unknown
    try {
      return this.ok(id, await this.dispatch(method, params ?? {}))
    } catch (err) {
      if (err instanceof RpcError) return this.fail(id, err.code, err.message)
      return this.fail(id, -32603, err instanceof Error ? err.message : String(err))
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize': {
        const asked = typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : ''
        return {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
        }
      }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }
      case 'tools/call': {
        const name = params['name']
        const tool = this.tools.find((t) => t.name === name)
        if (!tool) throw new RpcError(-32602, `Unknown tool: ${String(name)}`)
        const args = params['arguments'] ?? {}
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new RpcError(-32602, '"arguments" must be an object')
        try {
          return { content: [{ type: 'text', text: await tool.run(args as Record<string, unknown>) }] }
        } catch (err) {
          // A tool that fails is reported to the model as a result it can read and react to, not as a protocol error.
          return { isError: true, content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }] }
        }
      }
      default:
        throw new RpcError(-32601, `Method not found: ${method}`)
    }
  }

  private ok(id: Id, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result } satisfies Reply)
  }
  private fail(id: Id, code: number, message: string): string {
    return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } } satisfies Reply)
  }
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}
