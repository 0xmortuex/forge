import type { CommitDetails, CommitFile, CommitInfo, OpResult } from '../main/git'
import { fileIcon } from './icons'
import { askText, showMenu, type MenuItem } from './menu'

// The Git window: the commit history with a graph, filters, and the details and changed files of the selected commit.
// Operations on a commit (cherry-pick, revert, new branch, reset ...) are in its context menu.

export interface GitLogDeps {
  /** The window's own root element. */
  root: HTMLElement
  getRoot: () => string | null
  report: (msg: string, isError?: boolean) => void
  guard: (label: string, fn: () => Promise<void>) => Promise<void>
  /** Opens a read-only diff: \`left\` against \`right\` (text), titled after \`path\`. */
  showStaticDiff: (path: string, label: string, left: string, right: string) => Promise<void>
  /** Brings the window on screen. */
  reveal: () => void
  /** The working tree or branch changed: reload open files, refresh status. */
  onWorktreeChanged: () => Promise<void>
  refreshStatus: () => Promise<void>
}

export interface GitLog {
  refresh: () => Promise<void>
  /** Shows the history of one file (and brings the window up). */
  showFileHistory: (path: string) => Promise<void>
  /** Runs an operation that can stop on conflicts and reports how it went. */
  runOp: (label: string, op: () => Promise<OpResult>) => Promise<void>
}

const PAGE = 200
const LANE_W = 14
const ROW_H = 24
const LANE_COLORS = ['#26c6b0', '#82aaff', '#c792ea', '#ffcb6b', '#f78c6c', '#c3e88d', '#f07178', '#4dd0e1']

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p
const dirname = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')

export function ago(time: number): string {
  const s = Math.round((Date.now() - time * 1000) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(time * 1000).toLocaleDateString()
}

interface GraphRow {
  lane: number
  /** Lanes drawn as a vertical line through this row. */
  through: number[]
  /** Lanes that end in this commit from above. */
  joins: number[]
  /** The commit starts a new lane (a branch tip): nothing comes in from above. */
  fresh: boolean
  /** [from lane, to lane] for the lines leaving this commit downwards (its parents). */
  out: [number, number][]
  width: number
}

/** Assigns each commit a lane and works out the lines between rows (newest commit first). */
function layoutGraph(commits: CommitInfo[]): GraphRow[] {
  const lanes: (string | null)[] = []
  const rows: GraphRow[] = []
  for (const c of commits) {
    // Every lane waiting for this commit ends here; the leftmost one is the commit's own.
    const waiting = lanes.map((s, i) => (s === c.sha ? i : -1)).filter((i) => i >= 0)
    let lane = waiting[0] ?? -1
    if (lane < 0) {
      lane = lanes.indexOf(null)
      if (lane < 0) lane = lanes.length
      lanes[lane] = c.sha
    }
    const fresh = waiting.length === 0
    const joins = waiting.filter((i) => i !== lane)
    const through = lanes.map((s, i) => (s !== null && i !== lane && !joins.includes(i) ? i : -1)).filter((i) => i >= 0)
    for (const j of joins) lanes[j] = null
    const out: [number, number][] = []
    const [first, ...others] = c.parents
    lanes[lane] = first ?? null
    if (first) out.push([lane, lane])
    for (const p of others) {
      let k = lanes.indexOf(p)
      if (k < 0) {
        k = lanes.indexOf(null)
        if (k < 0) k = lanes.length
        lanes[k] = p
      }
      out.push([lane, k])
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    rows.push({ lane, through, joins, fresh, out, width: Math.max(lane, ...through, ...joins, ...out.map((o) => o[1])) + 1 })
  }
  return rows
}

function graphSvg(row: GraphRow, width: number, color: (lane: number) => string): string {
  const x = (l: number): number => l * LANE_W + LANE_W / 2
  const mid = ROW_H / 2
  const parts: string[] = []
  for (const l of row.through) parts.push(`<line x1="${x(l)}" y1="0" x2="${x(l)}" y2="${ROW_H}" stroke="${color(l)}" stroke-width="1.6"/>`)
  for (const l of row.joins) parts.push(`<path d="M${x(l)} 0 Q${x(l)} ${mid} ${x(row.lane)} ${mid}" fill="none" stroke="${color(l)}" stroke-width="1.6"/>`)
  // The line coming into this commit from above (if its lane was already running).
  if (!row.fresh) parts.push(`<line x1="${x(row.lane)}" y1="0" x2="${x(row.lane)}" y2="${mid}" stroke="${color(row.lane)}" stroke-width="1.6"/>`)
  for (const [from, to] of row.out) {
    if (from === to) parts.push(`<line x1="${x(from)}" y1="${mid}" x2="${x(to)}" y2="${ROW_H}" stroke="${color(to)}" stroke-width="1.6"/>`)
    else parts.push(`<path d="M${x(from)} ${mid} Q${x(to)} ${mid} ${x(to)} ${ROW_H}" fill="none" stroke="${color(to)}" stroke-width="1.6"/>`)
  }
  parts.push(`<circle cx="${x(row.lane)}" cy="${mid}" r="4" fill="${color(row.lane)}" stroke="var(--island)" stroke-width="1.5"/>`)
  return `<svg width="${width}" height="${ROW_H}" viewBox="0 0 ${width} ${ROW_H}">${parts.join('')}</svg>`
}

export function initGitLog(deps: GitLogDeps): GitLog {
  const el = (tag: string, cls = '', text = ''): HTMLElement => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  // ---- Layout ----
  const bar = el('div', 'tool-bar git-bar')
  const branchSel = el('select', 'field git-branch') as HTMLSelectElement
  const msgInput = el('input', 'field git-filter') as HTMLInputElement
  msgInput.placeholder = 'Message'
  msgInput.spellcheck = false
  const authorInput = el('input', 'field git-filter') as HTMLInputElement
  authorInput.placeholder = 'Author'
  authorInput.spellcheck = false
  const pathChip = el('button', 'chip on info git-pathchip')
  pathChip.hidden = true
  pathChip.title = 'Show the whole history again'
  const fetchBtn = el('button', 'btn git-fetch', 'Fetch')
  bar.append(branchSel, msgInput, authorInput, pathChip, el('span', 'grow'), fetchBtn)
  const banner = el('div', 'git-banner')
  banner.hidden = true
  const body = el('div', 'git-body')
  const listEl = el('div', 'git-commits')
  const details = el('div', 'git-details')
  body.append(listEl, details)
  deps.root.replaceChildren(bar, banner, body)

  let commits: CommitInfo[] = []
  let graph: GraphRow[] = []
  let selected: string | null = null
  let filePath: string | null = null
  let more = true
  let loading = false
  let seq = 0
  let graphWidth = 0
  const current = (): string => branchSel.value

  async function fillBranches(): Promise<void> {
    const root = deps.getRoot()
    if (!root) return
    const prev = branchSel.value
    const list = await window.forge.gitBranchesFull(root)
    branchSel.replaceChildren()
    const add = (value: string, label: string): void => {
      const o = el('option', '', label) as HTMLOptionElement
      o.value = value
      branchSel.append(o)
    }
    add('', 'Current branch')
    add('all', 'All branches')
    for (const b of list) add(b.name, b.remote ? `${b.name} (remote)` : b.name)
    if ([...branchSel.options].some((o) => o.value === prev)) branchSel.value = prev
  }

  const color = (lane: number): string => LANE_COLORS[lane % LANE_COLORS.length] ?? '#26c6b0'
  const filtered = (): boolean => !!(msgInput.value.trim() || authorInput.value.trim() || filePath)

  function refBadge(ref: string): HTMLElement {
    const tag = ref.startsWith('tag: ')
    const head = ref.startsWith('HEAD -> ')
    const name = tag ? ref.slice(5) : head ? ref.slice(8) : ref
    const remote = !tag && !head && name.includes('/')
    const b = el('span', `ref ${tag ? 'tag' : remote ? 'remote' : 'local'}${head ? ' head' : ''}`, name)
    return b
  }

  function drawRows(from: number): void {
    const showGraph = !filtered()
    for (let i = from; i < commits.length; i++) {
      const c = commits[i]!
      const row = el('div', 'gc' + (c.sha === selected ? ' sel' : ''))
      row.dataset['sha'] = c.sha
      if (showGraph && graph[i]) {
        const g = el('span', 'gcg')
        g.style.width = `${graphWidth}px`
        g.innerHTML = graphSvg(graph[i]!, graphWidth, color)
        row.append(g)
      }
      const refs = el('span', 'gcrefs')
      for (const r of c.refs) refs.append(refBadge(r))
      const subject = el('span', 'gcsub', c.subject)
      const author = el('span', 'gcauthor', c.author)
      const when = el('span', 'gcwhen', ago(c.time))
      when.title = new Date(c.time * 1000).toLocaleString()
      row.append(subject, refs, author, when)
      row.onclick = () => void select(c.sha)
      row.oncontextmenu = (ev) => {
        ev.preventDefault()
        void select(c.sha)
        showMenu(ev.clientX, ev.clientY, commitMenu(c))
      }
      listEl.append(row)
    }
  }

  async function load(reset: boolean): Promise<void> {
    const root = deps.getRoot()
    if (!root || loading) return
    const mine = ++seq
    loading = true
    try {
      if (reset) {
        commits = []
        more = true
        listEl.replaceChildren()
        await fillBranches()
      }
      const skip = commits.length
      const page = await window.forge.gitLog(root, {
        branch: current(),
        text: msgInput.value.trim() || undefined,
        author: authorInput.value.trim() || undefined,
        path: filePath ?? undefined,
        skip,
        limit: PAGE
      })
      if (mine !== seq) return
      more = page.length === PAGE
      commits.push(...page)
      graph = layoutGraph(commits)
      graphWidth = Math.max(1, ...graph.map((g) => g.width)) * LANE_W + 6
      if (reset) listEl.replaceChildren()
      else if (!filtered()) {
        // The graph of earlier rows may have gained lanes: simplest to draw it all again.
        listEl.replaceChildren()
        drawRows(0)
        return
      }
      drawRows(reset ? 0 : skip)
      if (!commits.length) listEl.append(el('div', 'hint', filtered() ? 'No commits match the filters' : 'No commits yet'))
    } catch (err) {
      deps.report(`Git log: ${err instanceof Error ? err.message : String(err)}`, true)
      throw err
    } finally {
      loading = false
    }
  }

  listEl.onscroll = () => {
    if (more && !loading && listEl.scrollTop + listEl.clientHeight > listEl.scrollHeight - 160) void load(false).catch(() => undefined)
  }

  // ---- Details ----
  async function select(sha: string): Promise<void> {
    selected = sha
    listEl.querySelectorAll('.gc').forEach((r) => r.classList.toggle('sel', (r as HTMLElement).dataset['sha'] === sha))
    const root = deps.getRoot()
    if (!root) return
    details.replaceChildren(el('div', 'hint', 'Loading…'))
    let d: CommitDetails
    try {
      d = await window.forge.gitCommitDetails(root, sha)
    } catch (err) {
      details.replaceChildren(el('div', 'hint herr', `Could not read the commit: ${err instanceof Error ? err.message : String(err)}`))
      throw err
    }
    if (selected !== sha) return
    const head = el('div', 'gd-head')
    head.append(el('div', 'gd-subject', d.subject))
    const meta = el('div', 'gd-meta')
    meta.textContent = `${d.sha.slice(0, 8)} · ${d.author} <${d.email}> · ${new Date(d.time * 1000).toLocaleString()}`
    head.append(meta)
    if (d.refs.length) {
      const refs = el('div', 'gcrefs')
      for (const r of d.refs) refs.append(refBadge(r))
      head.append(refs)
    }
    if (d.body) head.append(el('pre', 'gd-body', d.body))
    const files = el('div', 'gd-files')
    files.append(el('div', 'gd-count', `${d.files.length} file${d.files.length === 1 ? '' : 's'} changed`))
    for (const f of d.files) files.append(fileRow(d, f))
    details.replaceChildren(head, files)
  }

  function fileRow(d: CommitDetails, f: CommitFile): HTMLElement {
    const row = el('div', 'gf')
    row.insertAdjacentHTML('beforeend', fileIcon(basename(f.path)))
    row.append(el('span', `badge ${f.status === 'A' ? 'added' : f.status === 'D' ? 'deleted' : f.status === 'R' ? 'renamed' : 'modified'}`, f.status))
    row.append(el('span', 'name', basename(f.path)))
    const root = deps.getRoot() ?? ''
    row.append(el('span', 'dir', dirname(f.path).slice(root.length).replace(/^[\\/]/, '')))
    row.onclick = () => {
      void deps
        .guard(`Diff ${basename(f.path)}`, async () => {
          const rootDir = deps.getRoot()
          if (!rootDir) return
          const parent = d.parents[0]
          const left = f.status === 'A' || !parent ? '' : await window.forge.gitFileAt(rootDir, parent, f.oldPath ?? f.path)
          const right = f.status === 'D' ? '' : await window.forge.gitFileAt(rootDir, d.sha, f.path)
          await deps.showStaticDiff(f.path, d.sha.slice(0, 7), left, right)
        })
        .catch(() => undefined) // reported by guard
    }
    return row
  }

  // ---- Operations ----
  async function runOp(label: string, op: () => Promise<OpResult>): Promise<void> {
    await deps
      .guard(label, async () => {
        const res = await op()
        if (res.conflicts) deps.report(res.message, true)
        else deps.report(`${label}: done`)
        await deps.onWorktreeChanged()
        await deps.refreshStatus()
        await refresh()
      })
      .catch(() => undefined) // reported by guard
  }

  async function plain(label: string, op: () => Promise<void>, done: string): Promise<void> {
    await deps
      .guard(label, async () => {
        await op()
        deps.report(done)
        await deps.onWorktreeChanged()
        await deps.refreshStatus()
        await refresh()
      })
      .catch(() => undefined)
  }

  function commitMenu(c: CommitInfo): (MenuItem | 'sep')[] {
    const root = deps.getRoot()
    if (!root) return []
    const short = c.sha.slice(0, 7)
    const reset = (mode: 'soft' | 'mixed' | 'hard'): MenuItem => ({
      label: `Reset Current Branch to Here (${mode})…`,
      danger: mode === 'hard',
      run: () =>
        void plain(`Reset ${mode}`, async () => {
          if (mode === 'hard' && !confirm(`Reset the current branch to ${short} and DISCARD all uncommitted changes?`)) throw new Error('Cancelled')
          await window.forge.gitReset(root, c.sha, mode)
        }, `Reset to ${short} (${mode})`)
    })
    return [
      { label: 'Copy Revision Number', run: () => void window.forge.copyText(c.sha) },
      'sep',
      { label: 'Cherry-Pick', run: () => void runOp(`Cherry-pick ${short}`, () => window.forge.gitCherryPick(root, c.sha)) },
      { label: 'Revert Commit', run: () => void runOp(`Revert ${short}`, () => window.forge.gitRevertCommit(root, c.sha)) },
      'sep',
      { label: 'Checkout Revision', run: () => void plain('Checkout', () => window.forge.gitCheckout(root, c.sha, 'detached'), `Checked out ${short} (detached HEAD)`) },
      {
        label: 'New Branch from Here…',
        run: () =>
          void (async () => {
            const name = await askText('New branch name')
            if (name) await plain('New branch', () => window.forge.gitBranchFrom(root, name, c.sha), `Created and switched to ${name}`)
          })()
      },
      {
        label: 'New Tag…',
        run: () =>
          void (async () => {
            const name = await askText('Tag name')
            if (name) await plain('New tag', () => window.forge.gitTag(root, name, c.sha), `Tagged ${short} as ${name}`)
          })()
      },
      'sep',
      reset('soft'),
      reset('mixed'),
      reset('hard')
    ]
  }

  // ---- Banner for an operation that stopped (merge / rebase / cherry-pick / revert) ----
  async function updateBanner(): Promise<void> {
    const root = deps.getRoot()
    const op = root ? await window.forge.gitInProgress(root) : null
    banner.hidden = !op
    banner.replaceChildren()
    if (!op || !root) return
    banner.append(el('span', '', `A ${op} is in progress. Resolve the conflicts in the Commit window, then continue — or abort.`))
    const cont = el('button', 'btn-primary', 'Continue')
    cont.onclick = () => void runOp(`Continue ${op}`, () => window.forge.gitContinue(root))
    const abort = el('button', 'btn', 'Abort')
    abort.onclick = () => {
      if (!confirm(`Abort the ${op}? Everything it has done so far is undone.`)) return
      void plain(`Abort ${op}`, () => window.forge.gitAbort(root), `Aborted the ${op}`)
    }
    banner.append(cont, abort)
  }

  // ---- Controls ----
  const reload = (): void => void refresh().catch(() => undefined) // reported where it fails; also re-reads the banner
  branchSel.onchange = reload
  let filterTimer: number | undefined
  const later = (): void => {
    window.clearTimeout(filterTimer)
    filterTimer = window.setTimeout(reload, 300)
  }
  msgInput.oninput = later
  authorInput.oninput = later
  pathChip.onclick = () => {
    filePath = null
    pathChip.hidden = true
    reload()
  }
  fetchBtn.onclick = () => {
    const root = deps.getRoot()
    if (root) void plain('Fetch', () => window.forge.gitFetch(root), 'Fetched')
  }

  async function refresh(): Promise<void> {
    await updateBanner()
    await load(true)
  }

  return {
    refresh,
    runOp,
    async showFileHistory(path) {
      filePath = path
      pathChip.hidden = false
      pathChip.textContent = `History of ${basename(path)} ✕`
      deps.reveal()
      await load(true)
    }
  }
}

