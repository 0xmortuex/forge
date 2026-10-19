import type { BlameLine, ChangeKind, GitChange, GitStatus } from '../main/git'
import { ask, cleanCommitMessage, commitPrompt } from './ai'
import { icons } from './icons'
import { askText, showMenu, type MenuItem } from './menu'

export interface GitDeps {
  getRoot: () => string | null
  report: (msg: string, isError?: boolean) => void
  guard: (label: string, fn: () => Promise<void>) => Promise<void>
  openDiff: (path: string, kind: ChangeKind) => Promise<void>
  /** Opens a file in the editor (a conflicted file is resolved there). */
  openFile: (path: string) => Promise<void>
  /** Writes every modified open file to disk (git only sees what is on disk). */
  saveAll: () => Promise<void>
  /** The "Pull strategy" setting. */
  pullMode: () => 'ff-only' | 'merge' | 'rebase'
  /** Called with the ignored paths after every refresh (the tree dims them). */
  onIgnored: (paths: string[]) => void
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
  pull: () => void
  push: (force: boolean) => void
  updateBlame: (path: string | null, line: number, dirty: boolean) => void
  changeKind: (path: string) => ChangeKind | undefined
} {
  const branchWidget = byId('branch-widget')
  const branchName = byId('branch-name')
  const summary = byId('commit-summary')
  const list = byId('commit-list')
  const message = byId<HTMLTextAreaElement>('commit-msg')
  const commitBtn = byId<HTMLButtonElement>('commit-btn')
  const pushCommitBtn = byId<HTMLButtonElement>('commit-push-btn')
  const amendBox = byId<HTMLInputElement>('commit-amend')
  const blameEl = byId('st-blame')

  byId('branch-icon').innerHTML = icons.branch
  byId('commit-refresh').innerHTML = icons.refresh
  byId('commit-pull').innerHTML = icons.pull
  byId('commit-push').innerHTML = icons.push
  byId('commit-stash').innerHTML = icons.stash

  let status: GitStatus | null = null
  let operation: string | null = null // a merge / rebase / cherry-pick / revert that is stopped half way
  const checked = new Map<string, boolean>() // path -> included in next commit (default true)
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()

  // ---- Status ----
  async function refresh(): Promise<void> {
    blameCache.clear()
    const root = deps.getRoot()
    try {
      status = root ? await window.forge.gitStatus(root) : null
      operation = root && status ? await window.forge.gitInProgress(root) : null
    } catch (err) {
      status = null
      render()
      deps.report(`Git status: ${err instanceof Error ? err.message : String(err)}`, true)
      throw err
    }
    render()
    deps.onStatus(status?.changes ?? [])
    deps.onIgnored(status?.ignored ?? [])
  }

  function render(): void {
    branchWidget.hidden = !status
    if (status) {
      branchName.textContent = status.branch + (status.ahead ? ` ↑${status.ahead}` : '') + (status.behind ? ` ↓${status.behind}` : '')
      branchWidget.title = status.upstream ? `Tracking ${status.upstream}` : 'No upstream yet — Push will publish this branch'
    }
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
    const conflicted = status.changes.some((c) => c.kind === 'conflict')
    // While a merge is open, the button finishes it instead (git does not allow a partial commit then).
    commitBtn.textContent = operation ? `Complete ${operation}` : 'Commit'
    commitBtn.disabled = conflicted
    commitBtn.title = conflicted ? 'Resolve the conflicts first: open a conflicted file, accept a side, then right-click → Mark as Resolved' : ''
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
      // A conflicted file has no meaningful diff: it is resolved in the editor, where its conflict blocks are marked.
      row.onclick = () => void (c.kind === 'conflict' ? deps.openFile(c.path) : deps.openDiff(c.path, c.kind)).catch(() => undefined) // reported by the opener
      row.oncontextmenu = (ev) => {
        ev.preventDefault()
        showMenu(ev.clientX, ev.clientY, changeMenu(c))
      }
      list.append(row)
    }
  }

  // ---- Commit ----
  commitBtn.onclick = () => {
    const root = deps.getRoot()
    if (!root || !status) return
    if (operation) {
      const op = operation
      commitBtn.disabled = true
      void deps
        .guard(`Complete ${op}`, async () => {
          const res = await window.forge.gitContinue(root)
          deps.report(res.ok ? `Completed the ${op}` : res.message, !res.ok)
          await deps.onWorktreeChanged()
          await refresh()
        })
        .catch(() => undefined) // already reported by guard
        .finally(() => (commitBtn.disabled = !status))
      return
    }
    void commit(root, false)
  }
  byId('commit-push-btn').onclick = () => {
    const root = deps.getRoot()
    if (root && status) void commit(root, true)
  }

  // "Generate message": the ticked changes are described by the AI server the user set up.
  const aiBtn = byId<HTMLButtonElement>('commit-ai-btn')
  aiBtn.onclick = () => {
    const root = deps.getRoot()
    if (!root || !status) return
    const changes = status.changes.filter((c) => c.kind !== 'conflict' && (checked.get(c.path) ?? true)).map((c) => ({ path: c.path, kind: c.kind }))
    if (!changes.length) return deps.report('Tick the files to describe first', true)
    aiBtn.disabled = true
    aiBtn.textContent = 'Writing…'
    void deps
      .guard('Generate commit message', async () => {
        await deps.saveAll()
        const diff = await window.forge.gitDiffForCommit(root, changes)
        if (!diff.trim()) throw new Error('There is nothing to describe')
        message.value = cleanCommitMessage(await ask(commitPrompt(diff), { maxTokens: 300, temperature: 0.2, timeoutMs: 60000 }))
      })
      .catch(() => undefined) // already reported by guard
      .finally(() => {
        aiBtn.disabled = false
        aiBtn.textContent = 'Generate message'
      })
  }

  /** Commits the ticked files (saving open ones first), and pushes too if asked. */
  async function commit(root: string, thenPush: boolean): Promise<void> {
    if (!status || operation) return
    const amend = amendBox.checked
    const paths = status.changes.filter((c) => c.kind !== 'conflict' && (checked.get(c.path) ?? true)).map((c) => c.path)
    commitBtn.disabled = true
    pushCommitBtn.disabled = true
    await deps
      .guard(thenPush ? 'Commit and push' : 'Commit', async () => {
        await deps.saveAll() // git only commits what is on disk
        await window.forge.gitCommit(root, message.value, paths, amend)
        message.value = ''
        amendBox.checked = false
        for (const p of paths) checked.delete(p)
        deps.report(amend ? 'Amended the last commit' : `Committed ${paths.length} file${paths.length === 1 ? '' : 's'}`)
        await deps.onWorktreeChanged()
        if (thenPush) {
          await window.forge.gitPush(root)
          deps.report('Pushed')
        }
        await refresh()
      })
      .catch(() => undefined) // already reported by guard
      .finally(() => {
        commitBtn.disabled = !status
        pushCommitBtn.disabled = !status
      })
  }

  // Ticking "Amend" fills in the previous commit's message, so it can be kept or changed.
  amendBox.onchange = () => {
    const root = deps.getRoot()
    if (!amendBox.checked || !root || message.value.trim()) return
    void deps
      .guard('Amend', async () => {
        const last = await window.forge.gitCommitDetails(root, 'HEAD')
        message.value = last.body ? `${last.subject}\n\n${last.body}` : last.subject
      })
      .catch(() => undefined) // already reported by guard
  }
  byId('commit-refresh').onclick = () => void refresh().catch(() => undefined)

  // ---- Revert / push / pull / stash ----
  function changeMenu(c: GitChange): (MenuItem | 'sep')[] {
    const root = deps.getRoot()
    if (c.kind === 'conflict') {
      const name = basename(c.path)
      const resolve = (how: 'ours' | 'theirs' | 'mark', done: string): void =>
        void runOp('Resolve', async () => {
          if (!root) return false
          if (how === 'mark') await deps.saveAll() // the resolved text must be on disk before it is staged
          await window.forge.gitResolve(root, c.path, how)
          return true
        }, done, true)
      return [
        { label: 'Open Conflicted File', run: () => void deps.openFile(c.path).catch(() => undefined) },
        'sep',
        { label: 'Accept Ours (whole file)', run: () => resolve('ours', `Took our version of ${name}`) },
        { label: 'Accept Theirs (whole file)', run: () => resolve('theirs', `Took their version of ${name}`) },
        { label: 'Mark as Resolved', run: () => resolve('mark', `Marked ${name} as resolved`) }
      ]
    }
    const items: (MenuItem | 'sep')[] = [{ label: 'Show Diff', run: () => void deps.openDiff(c.path, c.kind).catch(() => undefined) }]
    if (!root) return items
    items.push('sep')
    const name = basename(c.path)
    if (c.kind === 'untracked') {
      items.push({
        label: 'Add to .gitignore',
        run: () => void runOp('Ignore', async () => void (await window.forge.gitIgnore(root, c.path)), `Added ${name} to .gitignore`, false)
      })
      items.push({
        label: 'Delete…',
        danger: true,
        run: () =>
          void runOp('Delete', async () => {
            if (!confirm(`Move "${name}" to the Recycle Bin?`)) return false
            await window.forge.trash(c.path)
            return true
          }, `Moved ${name} to the Recycle Bin`, true)
      })
    } else {
      const label = c.kind === 'added' ? 'Unstage…' : 'Revert…'
      const prompt =
        c.kind === 'added'
          ? `Unstage "${name}"? The file stays on disk.`
          : `Revert "${name}" to the last commit? Your changes to it will be lost.`
      items.push({
        label,
        danger: c.kind !== 'added',
        run: () =>
          void runOp(label.replace('…', ''), async () => {
            if (!confirm(prompt)) return false
            await window.forge.gitRevert(root, c.path, c.kind)
            return true
          }, c.kind === 'added' ? `Unstaged ${name}` : `Reverted ${name}`, true)
      })
    }
    return items
  }

  /**
   * Runs one git operation with the usual reporting. `action` returns false if the user backed out.
   * `worktree`: the working tree changed, so reload open files and close stale diffs.
   */
  async function runOp(label: string, action: () => Promise<boolean | void>, done: string, worktree: boolean): Promise<void> {
    await deps
      .guard(label, async () => {
        if ((await action()) === false) return
        deps.report(done)
        if (worktree) await deps.onWorktreeChanged()
        await refresh()
      })
      .catch(() => undefined) // already reported by guard
  }

  function pull(): void {
    const root = deps.getRoot()
    if (!root || !status) return
    void deps
      .guard('Pull', async () => {
        const res = await window.forge.gitPull(root, deps.pullMode())
        deps.report(res.conflicts ? res.message : res.ok && /Already up to date/i.test(res.message) ? 'Already up to date' : 'Pulled', res.conflicts)
        await deps.onWorktreeChanged()
        await refresh()
      })
      .catch(() => undefined) // already reported by guard
  }

  function push(force: boolean): void {
    const root = deps.getRoot()
    if (!root || !status) return
    if (!force) return void runOp('Push', () => window.forge.gitPush(root), 'Pushed', false)
    void runOp('Force push', async () => {
      if (!confirm('Force-push the current branch? Commits on the remote that you do not have will be overwritten. (It refuses if someone else has pushed since you last fetched.)')) return false
      await window.forge.gitPush(root, true)
      return true
    }, 'Force-pushed', false)
  }

  byId('commit-pull').onclick = pull
  byId('commit-push').onclick = () => push(false)
  byId('commit-push').oncontextmenu = (ev) => {
    ev.preventDefault()
    showMenu(ev.clientX, ev.clientY, [{ label: 'Force Push (with lease)…', danger: true, run: () => push(true) }])
  }
  byId('commit-stash').onclick = () => {
    const root = deps.getRoot()
    if (!root || !status) return
    const rect = byId('commit-stash').getBoundingClientRect()
    void deps
      .guard('Stash', async () => {
        const stashes = await window.forge.gitStashList(root)
        const items: (MenuItem | 'sep')[] = [
          {
            label: 'Stash Changes…',
            run: () =>
              void runOp('Stash', async () => {
                const message = await askText('Stash message (optional)')
                if (message === null) return false
                await window.forge.gitStashPush(root, message)
                return true
              }, 'Stashed your changes', true)
          }
        ]
        if (stashes.length) items.push('sep')
        for (const s of stashes) {
          items.push({
            label: `Apply: ${s.message}`,
            run: () => void runOp('Stash apply', () => window.forge.gitStashApply(root, s.ref), `Applied ${s.ref} (kept in the stash list)`, true)
          })
          items.push({
            label: `Pop: ${s.message}`,
            run: () => void runOp('Stash pop', () => window.forge.gitStashPop(root, s.ref), `Applied and removed ${s.ref}`, true)
          })
          items.push({
            label: `Drop: ${s.message}`,
            danger: true,
            run: () =>
              void runOp('Stash drop', async () => {
                if (!confirm(`Permanently drop "${s.message}"?`)) return false
                await window.forge.gitStashDrop(root, s.ref)
                return true
              }, `Dropped ${s.ref}`, false)
          })
        }
        showMenu(rect.left, rect.bottom + 4, items)
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
    pull,
    push,
    updateBlame,
    changeKind: (path) => status?.changes.find((c) => norm(c.path) === norm(path))?.kind
  }
}
