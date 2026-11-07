import { realpathSync, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { FilesService } from '../main/files'
import { GitService } from '../main/git'
import { FileIndex } from '../main/platform/fileindex'
import { McpServer, projectTools } from './server'

// node out/main/mcp.js --root <project folder>
// Serves the project to an MCP client over stdio: one JSON-RPC message per line on stdin, one per line on stdout.
// Nothing but protocol messages may be written to stdout; diagnostics go to stderr.

function fail(message: string): never {
  process.stderr.write(`forge-mcp: ${message}\n`)
  process.exit(1)
}

function projectRoot(): string {
  const at = process.argv.indexOf('--root')
  const arg = at >= 0 ? process.argv[at + 1] : undefined
  if (!arg) return fail('usage: node mcp.js --root <project folder>')
  try {
    if (!statSync(arg).isDirectory()) return fail(`${arg} is not a folder`)
    return realpathSync.native(arg)
  } catch (err) {
    return fail(`cannot use ${arg}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function main(): Promise<void> {
  const root = projectRoot()
  const index = new FileIndex()
  const { files } = await index.open(root).catch((err: unknown) => fail(`cannot index ${root}: ${err instanceof Error ? err.message : String(err)}`))
  process.stderr.write(`forge-mcp: serving ${root} (${files} files)\n`)

  const server = new McpServer(projectTools({ root, index, files: new FilesService(), git: new GitService() }))
  const pending = new Set<Promise<void>>()
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    if (!line.trim()) return
    const job: Promise<void> = server
      .handle(line)
      .then((reply) => {
        if (reply !== null) process.stdout.write(reply + '\n')
      })
      .catch((err: unknown) => void process.stderr.write(`forge-mcp: unexpected failure: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`))
      .finally(() => void pending.delete(job))
    pending.add(job)
  })
  // The client closed stdin: finish what is in flight, then leave.
  lines.on('close', () => void Promise.all(pending).then(() => process.exit(0)))
}

main().catch((err: unknown) => fail(err instanceof Error ? (err.stack ?? err.message) : String(err)))
