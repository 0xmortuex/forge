import { execFile } from 'node:child_process'
import { ipcMain } from 'electron'
import { detailPr, summarizePr, type PrDetail, type PrSummary } from './ghparse'

// GitHub pull requests through the `gh` CLI (the user's own login; Forge never sees a token). Tests point FORGE_GH at a
// script that stands in for gh.

export interface GhStatus {
  installed: boolean
  loggedIn: boolean
  /** "owner/name" of the repository the folder belongs to, if it is a GitHub repository. */
  repo: string | null
  message: string
}

interface Result {
  stdout: string
  stderr: string
  code: number
}

function runGh(cwd: string, args: string[]): Promise<Result> {
  const script = process.env['FORGE_GH']
  const [command, argv, env] = script
    ? [process.execPath, [script, ...args], { ...process.env, ELECTRON_RUN_AS_NODE: '1' }]
    : ['gh', args, { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }]
  return new Promise((done, fail) => {
    execFile(command, argv, { cwd, env, maxBuffer: 32 * 1024 * 1024, timeout: 60000, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = (err as (Error & { code?: unknown }) | null)?.code
      if (err && typeof code !== 'number') {
        return fail(new Error(code === 'ENOENT' ? 'The GitHub CLI (gh) is not installed. Get it from https://cli.github.com' : `gh: ${err.message}`))
      }
      done({ stdout, stderr, code: typeof code === 'number' ? code : 0 })
    })
  })
}

async function gh(cwd: string, args: string[]): Promise<string> {
  const { stdout, stderr, code } = await runGh(cwd, args)
  if (code !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(stderr.trim() || stdout.trim()).split('\n').slice(0, 4).join(' ')}`)
  return stdout
}

function prNumber(n: unknown): string {
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new Error(`Not a pull request number: ${String(n)}`)
  return String(n)
}

const LIST_FIELDS = 'number,title,author,headRefName,baseRefName,isDraft,state,updatedAt,url,reviewDecision,statusCheckRollup'
const VIEW_FIELDS = `${LIST_FIELDS},body,additions,deletions,files,comments,reviews,mergeable`

export async function ghStatus(root: string): Promise<GhStatus> {
  try {
    await gh(root, ['--version'])
  } catch (err) {
    return { installed: false, loggedIn: false, repo: null, message: err instanceof Error ? err.message : String(err) }
  }
  const auth = await runGh(root, ['auth', 'status'])
  if (auth.code !== 0) return { installed: true, loggedIn: false, repo: null, message: 'Not logged in to GitHub. Run "gh auth login" in a terminal.' }
  const repo = await runGh(root, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
  if (repo.code !== 0) return { installed: true, loggedIn: true, repo: null, message: 'This folder is not a GitHub repository (or has no remote).' }
  return { installed: true, loggedIn: true, repo: repo.stdout.trim(), message: '' }
}

export async function listPrs(root: string, state: 'open' | 'closed' | 'merged' | 'all'): Promise<PrSummary[]> {
  const out = await gh(root, ['pr', 'list', '--state', state, '--limit', '50', '--json', LIST_FIELDS])
  const parsed = JSON.parse(out || '[]') as unknown
  if (!Array.isArray(parsed)) throw new Error('gh pr list returned something unexpected')
  return parsed.map(summarizePr)
}

export async function viewPr(root: string, n: number): Promise<PrDetail> {
  return detailPr(JSON.parse(await gh(root, ['pr', 'view', prNumber(n), '--json', VIEW_FIELDS])) as unknown)
}

export function registerGithub(): void {
  ipcMain.handle('gh:status', (_e, root: string) => ghStatus(root))
  ipcMain.handle('gh:list', (_e, root: string, state: 'open' | 'closed' | 'merged' | 'all') => listPrs(root, state))
  ipcMain.handle('gh:view', (_e, root: string, n: number) => viewPr(root, n))
  ipcMain.handle('gh:diff', (_e, root: string, n: number) => gh(root, ['pr', 'diff', prNumber(n), '--color', 'never']))
  ipcMain.handle('gh:checkout', async (_e, root: string, n: number): Promise<string> => {
    const { stdout, stderr, code } = await runGh(root, ['pr', 'checkout', prNumber(n)])
    const said = (stderr.trim() || stdout.trim()).split('\n').slice(-3).join(' ')
    if (code !== 0) throw new Error(`gh pr checkout failed: ${said}`)
    return said || `Checked out #${n}`
  })
  ipcMain.handle('gh:comment', (_e, root: string, n: number, body: string) => {
    if (!body.trim()) throw new Error('The comment is empty')
    return gh(root, ['pr', 'comment', prNumber(n), '--body', body]).then(() => undefined)
  })
  ipcMain.handle('gh:create', async (_e, root: string, opts: { title: string; body: string; base?: string; draft?: boolean }): Promise<string> => {
    if (!opts.title.trim()) throw new Error('The pull request needs a title')
    const args = ['pr', 'create', '--title', opts.title, '--body', opts.body]
    if (opts.base) args.push('--base', opts.base)
    if (opts.draft) args.push('--draft')
    const out = await gh(root, args)
    return out.trim().split('\n').pop() ?? ''
  })
}
