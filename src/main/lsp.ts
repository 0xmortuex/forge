import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ipcMain, type WebContents } from 'electron'
import { findOnPath } from './terminal'
import {
  createMessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection
} from 'vscode-jsonrpc/node'

interface Launch {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

interface ServerSpec {
  id: string
  launch: () => Launch
}

const nodeRequire = createRequire(__filename)

// Servers can ask the client to apply an edit (e.g. after a command). The renderer owns the editor models,
// so the request is forwarded there and answered through 'lsp:applyEditResult'.
const APPLY_EDIT_TIMEOUT_MS = 30000
const pendingEdits = new Map<number, (r: { applied: boolean; failureReason?: string }) => void>()
let nextEditId = 1

function requestApplyEdit(wc: WebContents, edit: unknown): Promise<{ applied: boolean; failureReason?: string }> {
  return new Promise((resolve) => {
    const id = nextEditId++
    const timer = setTimeout(() => {
      pendingEdits.delete(id)
      resolve({ applied: false, failureReason: 'The editor did not answer in time' })
    }, APPLY_EDIT_TIMEOUT_MS)
    pendingEdits.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    if (wc.isDestroyed()) return resolve({ applied: false, failureReason: 'The window is gone' })
    wc.send('lsp:applyEdit', id, edit)
  })
}

/** Runs an npm package's bin script with Electron's own Node, so users need no separate Node install. */
function npmBin(pkg: string, binName: string): Launch {
  const pkgJsonPath = nodeRequire.resolve(`${pkg}/package.json`)
  const { bin } = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof bin === 'string' ? bin : bin[binName]
  if (!rel) throw new Error(`${pkg} has no bin "${binName}"`)
  return {
    command: process.execPath,
    args: [join(dirname(pkgJsonPath), rel), '--stdio'],
    env: { ELECTRON_RUN_AS_NODE: '1' }
  }
}

const SERVERS: Record<string, ServerSpec> = {
  typescript: { id: 'typescript', launch: () => npmBin('typescript-language-server', 'typescript-language-server') },
  python: { id: 'python', launch: () => npmBin('pyright', 'pyright-langserver') },
  // Mort's own language server (`mortc lsp`). Set MORTC to a mortc.py path to run it from a checkout.
  mort: {
    id: 'mort',
    launch: () => {
      const custom = process.env['MORTC']
      if (custom) return custom.endsWith('.py') ? { command: findOnPath(process.platform === 'win32' ? 'python' : 'python3'), args: [custom, 'lsp'] } : { command: custom, args: ['lsp'] }
      try {
        return { command: findOnPath('mortc'), args: ['lsp'] }
      } catch {
        throw new Error('mortc not found on PATH — install it (pip install mort-lang) or set the MORTC environment variable to your mortc.py')
      }
    }
  },
  // Not bundled: must be installed and on PATH.
  clangd: { id: 'clangd', launch: () => ({ command: 'clangd', args: [] }) }
}

// File extension -> [LSP languageId, server id].
const BY_EXT: Record<string, [string, string]> = {
  '.ts': ['typescript', 'typescript'], '.mts': ['typescript', 'typescript'], '.cts': ['typescript', 'typescript'],
  '.tsx': ['typescriptreact', 'typescript'],
  '.js': ['javascript', 'typescript'], '.mjs': ['javascript', 'typescript'], '.cjs': ['javascript', 'typescript'],
  '.jsx': ['javascriptreact', 'typescript'],
  '.py': ['python', 'python'],
  '.mx': ['mort', 'mort'],
  '.c': ['c', 'clangd'], '.h': ['c', 'clangd'],
  '.cpp': ['cpp', 'clangd'], '.cc': ['cpp', 'clangd'], '.cxx': ['cpp', 'clangd'], '.hpp': ['cpp', 'clangd']
}

// LSP error codes that mean "the document changed / request was superseded"; not real failures.
const CONTENT_MODIFIED = -32801
const REQUEST_CANCELLED = -32800

class Client {
  readonly ready: Promise<void>
  /** What the server said it can do, from its initialize response. */
  capabilities: Record<string, unknown> = {}
  /** tsserver only: whether the one-off project-loading query has been sent. */
  warmedUp = false
  private child: ChildProcessWithoutNullStreams
  private conn: MessageConnection

  constructor(
    readonly spec: ServerSpec,
    readonly root: string,
    private wc: WebContents,
    onDead: () => void
  ) {
    const launch = spec.launch()
    this.child = spawn(launch.command, launch.args, {
      cwd: root,
      env: { ...process.env, ...launch.env },
      windowsHide: true
    })
    // A missing binary (e.g. clangd) surfaces as 'error', not as an exit code.
    const spawned = new Promise<void>((resolve, reject) => {
      this.child.once('spawn', resolve)
      this.child.once('error', (err: NodeJS.ErrnoException) =>
        reject(
          err.code === 'ENOENT'
            ? new Error(`${launch.command} not found on PATH — install it to get ${spec.id} intelligence`)
            : err
        )
      )
    })
    this.child.stderr.on('data', (d: Buffer) => this.log(1, d.toString().trimEnd()))
    this.child.once('exit', (code) => {
      this.log(code === 0 ? 3 : 1, `${spec.id} language server exited (code ${code})`)
      onDead()
    })

    this.conn = createMessageConnection(
      new StreamMessageReader(this.child.stdout),
      new StreamMessageWriter(this.child.stdin)
    )
    this.conn.onNotification('textDocument/publishDiagnostics', (p: { uri: string; diagnostics: unknown[] }) => {
      if (!wc.isDestroyed()) wc.send('lsp:diagnostics', p.uri, p.diagnostics)
    })
    this.conn.onNotification('window/logMessage', (p: { type: number; message: string }) =>
      this.log(p.type, p.message)
    )
    this.conn.onNotification('window/showMessage', (p: { type: number; message: string }) =>
      this.log(p.type, p.message)
    )
    // Servers ask the client for settings and to register capabilities; we have none to give.
    this.conn.onRequest('workspace/configuration', (p: { items: unknown[] }) => p.items.map(() => null))
    this.conn.onRequest('workspace/workspaceFolders', () => [this.folder()])
    this.conn.onRequest('client/registerCapability', () => null)
    this.conn.onRequest('client/unregisterCapability', () => null)
    this.conn.onRequest('window/workDoneProgress/create', () => null)
    this.conn.onRequest('workspace/applyEdit', (p: { edit: unknown }) => requestApplyEdit(wc, p.edit))
    this.conn.listen()

    this.ready = spawned.then(() => this.initialize())
    // Surface startup failures to whoever awaits `ready`; also log here so they're never silent.
    this.ready.catch((err: Error) => this.log(1, `${spec.id}: ${err.message}`))
  }

  private folder(): { uri: string; name: string } {
    return { uri: pathToFileURL(this.root).href, name: basename(this.root) }
  }

  private log(type: number, message: string): void {
    if (!this.wc.isDestroyed()) this.wc.send('lsp:log', this.spec.id, type, message)
  }

  private async initialize(): Promise<void> {
    const init = (await this.conn.sendRequest('initialize', {
      processId: process.pid,
      rootUri: this.folder().uri,
      workspaceFolders: [this.folder()],
      clientInfo: { name: 'Forge' },
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true, applyEdit: true, workspaceEdit: { documentChanges: true } },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] }
            }
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: { labelOffsetSupport: true }
            }
          },
          definition: { linkSupport: true },
          references: {},
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
            symbolKind: { valueSet: Array.from({ length: 26 }, (_, i) => i + 1) }
          },
          rename: { prepareSupport: true },
          formatting: {},
          rangeFormatting: {},
          codeAction: {
            isPreferredSupport: true,
            dataSupport: true,
            resolveSupport: { properties: ['edit'] },
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports']
              }
            }
          },
          publishDiagnostics: {}
        }
      }
    })) as { capabilities: Record<string, unknown> }
    this.capabilities = init.capabilities
    await this.conn.sendNotification('initialized', {})
  }

  notify(method: string, params: unknown): Promise<void> {
    return this.conn.sendNotification(method, params)
  }

  async request(method: string, params: unknown): Promise<unknown> {
    try {
      return await this.conn.sendRequest(method, params)
    } catch (err) {
      if (err instanceof ResponseError && (err.code === CONTENT_MODIFIED || err.code === REQUEST_CANCELLED)) {
        return null
      }
      throw err
    }
  }

  kill(): void {
    this.conn.dispose()
    this.child.kill()
  }
}

interface Doc {
  client: Client
  opened: Promise<void>
}

const clients = new Map<string, Client>() // `${serverId}\0${root}`
const docs = new Map<string, Doc>() // document uri

function getDoc(uri: string): Doc {
  const d = docs.get(uri)
  if (!d) throw new Error(`Document is not open in a language server: ${uri}`)
  return d
}

export function registerLsp(): void {
  /** Returns false if no language server handles this file type (not an error). */
  ipcMain.handle(
    'lsp:open',
    async (e, root: string, uri: string, path: string, version: number, text: string): Promise<boolean> => {
      const entry = BY_EXT[extname(path).toLowerCase()]
      if (!entry) return false
      const [languageId, serverId] = entry
      const spec = SERVERS[serverId]
      if (!spec) throw new Error(`No server spec for ${serverId}`)

      const key = `${serverId}\0${root}`
      let client = clients.get(key)
      if (!client) {
        client = new Client(spec, root, e.sender, () => {
          clients.delete(key)
          for (const [u, d] of docs) if (d.client === client) docs.delete(u)
        })
        clients.set(key, client)
      }
      const c = client
      const opened = c.ready.then(() =>
        c.notify('textDocument/didOpen', { textDocument: { uri, languageId, version, text } })
      )
      docs.set(uri, { client: c, opened })
      await opened
      // tsserver loads the rest of the project lazily and answers early cross-file queries (references,
      // rename) with only what it has seen so far. One throwaway query when the first file opens makes it
      // load the project in the background, so the user's first real query gets complete answers.
      if (serverId === 'typescript' && !c.warmedUp) {
        c.warmedUp = true
        c.request('textDocument/references', {
          textDocument: { uri },
          position: { line: 0, character: 0 },
          context: { includeDeclaration: false }
        }).catch(() => undefined) // a failed warm-up is invisible by design; real queries report their own errors
      }
      return true
    }
  )

  ipcMain.handle('lsp:change', async (_e, uri: string, version: number, text: string) => {
    const d = getDoc(uri)
    await d.opened
    await d.client.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    })
  })

  ipcMain.handle('lsp:close', async (_e, uri: string) => {
    const d = docs.get(uri)
    if (!d) return
    docs.delete(uri)
    await d.opened
    await d.client.notify('textDocument/didClose', { textDocument: { uri } })
  })

  ipcMain.handle('lsp:capabilities', async (_e, uri: string) => {
    const d = getDoc(uri)
    await d.opened
    return d.client.capabilities
  })

  ipcMain.handle('lsp:applyEditResult', (_e, id: number, applied: boolean, failureReason?: string) => {
    pendingEdits.get(id)?.({ applied, failureReason })
    pendingEdits.delete(id)
  })

  ipcMain.handle('lsp:request', async (_e, uri: string, method: string, params: unknown) => {
    const d = getDoc(uri)
    await d.opened
    return d.client.request(method, params)
  })
}

/** Synchronous on purpose: runs during app quit, where an async shutdown handshake would not finish. */
export function killAllLsp(): void {
  for (const c of clients.values()) c.kill()
  clients.clear()
  docs.clear()
}
