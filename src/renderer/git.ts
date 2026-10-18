import type { BlameLine, ChangeKind, GitChange, GitStatus } from '../main/git'
import { icons } from './icons'
import { askText, showMenu, type MenuItem } from './menu'

export interface GitDeps {
  getRoot: () => string | null
  report: (msg: string, isError?: boolean) => void
  guard: (label: string, fn: () => Promise<void>) => Promise<void>
  openDiff: (path: string, kind: ChangeKind) => Promise<void>
  /** Called with the new status after every refresh so the tree can recolor itself. */
  onStatus: (changes: GitChange[]) => void
  /** The working tree changed under us (branch switch / commit): reload open files, close stale diffs. */
  onWorktreeChanged: () => Promise<void>
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

const BADGE: Record<ChangeKind, string> = {
  modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: '?', conflict: '!'
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p
const dirname = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')

export function initGit(deps: GitDeps): {
  refresh: () => Promise<void>
  updateBlame: (path: string | null, line: number, dirty: boolean) => void
  changeKind: (path: string) => ChangeKind | undefined
} {
  const branchWidget = byId('branch-widget')
  const branchName = byId('branch-name')
  const summary = byId('commit-summary')
  const list = byId('commit-list')
  const message = byId<HTMLTextAreaElement>('commit-msg')
  const commitBtn = byId<HTMLButtonElement>('commit-btn')
  const blameEl = byId('st-blame')

  byId('branch-icon').innerHTML = icons.branch
  byId('commit-refresh').innerHTML = icons.refresh

  let status: GitStatus | null = null
  const checked = new Map<string, boolean>() // path -> included in next commit (default true)
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()

  // ---- Status ----
  async function refresh(): Promise<void> {
    blameCache.clear()
    const root = deps.getRoot()
    try {
      status = root ? await window.forge.gitStatus(root) : null
    } catch (err) {
      status = null
      render()
      deps.report(`Git status: ${err instanceof Error ? err.message : String(err)}`, true)
      throw err
    }
    render()
    deps.onStatus(status?.changes ?? [])
  }

  function render(): void {
    branchWidget.hidden = !status
    if (status) branchName.textContent = status.branch
    list.replaceChildren()
    if (!status) {
      summary.textContent = ''
      const e = document.createElement('div')
      e.className = 'empty'
      e.textContent = deps.getRoot() ? 'This folder is not a git repository.' : 'Open a folder first (Ctrl+O).'
      list.append(e)
      commitBtn.disabled = true
      return
    }
    commitBtn.disabled = false
    summary.textContent = status.changes.length
      ? `${status.changes.length} change${status.changes.length === 1 ? '' : 's'}`
      : 'No changes'
    const root = deps.getRoot() ?? ''
    for (const c of [...status.changes].sort((a, b) => a.path.localeCompare(b.path))) {
      const row = document.createElement('div')
      row.className = 'change'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = checked.get(c.path) ?? true
      box.onchange = () => checked.set(c.path, box.checked)
      box.onclick = (e) => e.stopPropagation()
      const badge = document.createElement('span')
      badge.className = `badge ${c.kind}`
      badge.textContent = BADGE[c.kind]
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = basename(c.path)
      const dir = document.createElement('span')
      dir.className = 'dir'
      dir.textContent = dirname(c.path).slice(root.length).replace(/^[\\/]/, '')
      row.append(box, badge, name, dir)
      row.onclick = () => void deps.openDiff(c.path, c.kind).catch(() => undefined) // reported by the opener
      list.append(row)
    }
  }

  // ---- Commit ----
  commitBtn.onclick = () => {
    const root = deps.getRoot()
    if (!root || !status) return
    const paths = status.changes.filter((c) => checked.get(c.path) ?? true).map((c) => c.path)
    commitBtn.disabled = true
    void deps
      .guard('Commit', async () => {
        await window.forge.gitCommit(root, message.value, paths)
        message.value = ''
        for (const p of paths) checked.delete(p)
        deps.report(`Committed ${paths.length} file${paths.length === 1 ? '' : 's'}`)
        await deps.onWorktreeChanged()
        await refresh()
      })
      .catch(() => undefined) // already reported by guard
      .finally(() => (commitBtn.disabled = !status))
  }
  byId('commit-refresh').onclick = () => void refresh().catch(() => undefined)

  // ---- Branches ----
  branchWidget.onclick = () => {
    const root = deps.getRoot()
    if (!root || !status) return
    const current = status.branch
    void deps
      .guard('Git branches', async () => {
        const branches = await window.forge.gitBranches(root)
        const rect = branchWidget.getBoundingClientRect()
        const items: (MenuItem | 'sep')[] = branches.map((b) => ({
          label: (b === current ? '● ' : '   ') + b,
          run: () => {
            if (b !== current) void switchTo(() => window.forge.gitSwitch(root, b), `Switched to ${b}`)
          }
        }))
        items.push('sep', { label: 'New Branch…', run: () => void newBranch(root) })
        showMenu(rect.left, rect.bottom + 4, items)
      })
      .catch(() => undefined)
  }

  async function newBranch(root: string): Promise<void> {
    const name = await askText('New branch name')
    if (!name) return
    await switchTo(() => window.forge.gitCreateBranch(root, name), `Created and switched to ${name}`)
  }

  async function switchTo(action: () => Promise<void>, done: string): Promise<void> {
    await deps
      .guard('Git', async () => {
        await action()
        deps.report(done)
        await deps.onWorktreeChanged()
        await refresh()
      })
      .catch(() => undefined) // already reported by guard
  }

  // ---- Blame ----
  const blameCache = new Map<string, BlameLine[] | null>()
  const pending = new Map<string, Promise<BlameLine[] | null>>()
  let blameRequest = 0

  function blameFor(root: string, path: string): Promise<BlameLine[] | null> {
    const key = norm(path)
    if (blameCache.has(key)) return Promise.resolve(blameCache.get(key) ?? null)
    let p = pending.get(key)
    if (!p) {
      p = window.forge.gitBlame(root, path).then((lines) => {
        blameCache.set(key, lines)
        return lines
      })
      p.then(() => pending.delete(key), () => pending.delete(key))
      pending.set(key, p)
    }
    return p
  }

  function updateBlame(path: string | null, line: number, dirty: boolean): void {
    const id = ++blameRequest
    const root = deps.getRoot()
    // Unsaved edits shift line numbers, so blame would point at the wrong line.
    if (!path || !root || !status || dirty) {
      blameEl.textContent = ''
      blameEl.title = ''
      return
    }
    blameFor(root, path).then(
      (lines) => {
        if (id !== blameRequest) return
        const info = lines?.[line - 1]
        if (!info) {
          blameEl.textContent = ''
          return
        }
        if (/^0+$/.test(info.sha)) {
          blameEl.textContent = 'Not committed yet'
          blameEl.title = ''
          return
        }
        const d = new Date(info.time * 1000)
        blameEl.textContent = `Blame: ${info.author} ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        blameEl.title = `${info.sha.slice(0, 8)} ${info.summary}`
      },
      (err: unknown) => {
        if (id !== blameRequest) return
        blameEl.textContent = ''
        deps.report(`Git blame: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    )
  }

  return {
    refresh,
    updateBlame,
    changeKind: (path) => status?.changes.find((c) => norm(c.path) === norm(path))?.kind
  }
}
