import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { ago, type PrDetail, type PrSummary } from '../main/ghparse'
import { askText } from './menu'

// The Pull Requests window (GitHub, through the gh CLI): the open / closed / merged pull requests of the project's
// repository with their checks and review state, a detail pane, and checkout, diff, comment and create.

export interface GithubDeps {
  root: HTMLElement
  getRoot: () => string | null
  /** Opens text in a new tab (used for a pull request's diff). */
  openText: (ext: string, text: string) => Promise<void>
  /** Called after a checkout switched the branch, so Git views catch up. */
  branchChanged: () => void
  report: (msg: string, isError?: boolean) => void
}

export interface GithubView {
  refresh: () => Promise<void>
}

type State = 'open' | 'closed' | 'merged' | 'all'

const CHECK_TITLE = { pass: 'Checks passed', fail: 'Checks failed', pending: 'Checks running', none: 'No checks' } as const
const REVIEW_TITLE = { approved: 'Approved', changes: 'Changes requested', required: 'Review required', none: '' } as const

export function initGithub(d: GithubDeps): GithubView {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  const bar = el('div', 'tool-bar gh-bar')
  const title = el('span', 'tool-title', 'Pull Requests')
  const repoEl = el('span', 'gh-repo')
  repoEl.id = 'gh-repo'
  const stateSel = el('select', 'field gh-state')
  stateSel.id = 'gh-state'
  for (const [value, label] of [['open', 'Open'], ['closed', 'Closed'], ['merged', 'Merged'], ['all', 'All']] as const) {
    const o = el('option', '', label)
    o.value = value
    stateSel.append(o)
  }
  const refreshBtn = el('button', 'btn', 'Refresh')
  refreshBtn.id = 'gh-refresh'
  const newBtn = el('button', 'btn-primary', 'New Pull Request…')
  newBtn.id = 'gh-new'
  newBtn.disabled = true
  bar.append(title, repoEl, stateSel, refreshBtn, newBtn)

  const body = el('div', 'gh-body')
  const list = el('div', 'gh-list')
  list.id = 'gh-list'
  const detail = el('div', 'gh-detail')
  detail.id = 'gh-detail'
  body.append(list, detail)
  d.root.replaceChildren(bar, body)

  let seq = 0
  let selected: number | null = null

  const hint = (host: HTMLElement, text: string, error = false): void => host.replaceChildren(el('div', error ? 'hint err' : 'hint', text))

  const run = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn()
    } catch (err) {
      d.report(`${label}: ${err instanceof Error ? err.message : String(err)}`, true)
      return undefined
    }
  }

  function row(pr: PrSummary): HTMLElement {
    const r = el('div', `gh-pr${pr.number === selected ? ' selected' : ''}`)
    r.dataset['number'] = String(pr.number)
    const head = el('div', 'gh-pr-head')
    const dot = el('span', `gh-checks ${pr.checks}`)
    dot.title = CHECK_TITLE[pr.checks]
    head.append(dot, el('span', 'gh-pr-title', pr.title), el('span', 'gh-pr-num', `#${pr.number}`))
    const meta = el('div', 'gh-pr-meta')
    meta.append(el('span', '', `${pr.author} · ${pr.head} → ${pr.base} · ${ago(pr.updatedAt)}`))
    if (pr.draft) meta.append(el('span', 'gh-badge draft', 'Draft'))
    if (pr.state !== 'open') meta.append(el('span', `gh-badge ${pr.state}`, pr.state === 'merged' ? 'Merged' : 'Closed'))
    if (pr.review !== 'none') meta.append(el('span', `gh-badge review-${pr.review}`, REVIEW_TITLE[pr.review]))
    r.append(head, meta)
    r.onclick = () => {
      selected = pr.number
      list.querySelectorAll('.gh-pr').forEach((x) => x.classList.toggle('selected', (x as HTMLElement).dataset['number'] === String(pr.number)))
      void showDetail(pr.number)
    }
    return r
  }

  async function showDetail(n: number): Promise<void> {
    const root = d.getRoot()
    if (!root) return
    hint(detail, 'Loading…')
    const pr = await run(`Pull request #${n}`, () => window.forge.ghView(root, n))
    if (!pr || selected !== n) return
    detail.replaceChildren(renderDetail(pr, root))
  }

  function renderDetail(pr: PrDetail, root: string): HTMLElement {
    const box = el('div', 'gh-card')
    box.append(el('h2', 'gh-title', `${pr.title} `), el('div', 'gh-sub', `#${pr.number} · ${pr.author} wants to merge ${pr.head} into ${pr.base} · ${pr.state}${pr.draft ? ' (draft)' : ''}`))
    box.querySelector('h2')?.append(el('span', 'gh-num', `#${pr.number}`))
    const stats = el('div', 'gh-stats')
    stats.append(el('span', `gh-badge checks-${pr.checks}`, CHECK_TITLE[pr.checks]), el('span', 'gh-add', `+${pr.additions}`), el('span', 'gh-del', `−${pr.deletions}`), el('span', '', `${pr.files.length} files`))
    if (pr.review !== 'none') stats.append(el('span', `gh-badge review-${pr.review}`, REVIEW_TITLE[pr.review]))
    if (pr.mergeable === 'CONFLICTING') stats.append(el('span', 'gh-badge review-changes', 'Has conflicts'))

    const actions = el('div', 'gh-actions')
    const button = (id: string, label: string, onClick: () => void, primary = false): HTMLButtonElement => {
      const b = el('button', primary ? 'btn-primary' : 'btn', label)
      b.id = id
      b.onclick = onClick
      return b
    }
    actions.append(
      button('gh-checkout', 'Checkout', () => {
        void run('Checkout', async () => {
          const said = await window.forge.ghCheckout(root, pr.number)
          d.report(said)
          d.branchChanged()
        })
      }, true),
      button('gh-diff', 'View Diff', () => {
        void run('Diff', async () => d.openText('diff', await window.forge.ghDiff(root, pr.number)))
      }),
      button('gh-comment', 'Add Comment…', () => {
        void run('Comment', async () => {
          const text = await askText(`Comment on #${pr.number}`)
          if (text === null || !text.trim()) return
          await window.forge.ghComment(root, pr.number, text)
          d.report(`Commented on #${pr.number}`)
          await showDetail(pr.number)
        })
      }),
      button('gh-browser', 'Open in Browser', () => {
        void run('Open in browser', () => window.forge.openExternal(pr.url))
      })
    )
    box.append(stats, actions)

    if (pr.body.trim()) {
      const md = el('div', 'md-body gh-text')
      md.innerHTML = DOMPurify.sanitize(marked.parse(pr.body, { gfm: true, async: false }) as string)
      box.append(md)
    }
    if (pr.files.length) {
      box.append(el('h3', '', 'Files changed'))
      const files = el('div', 'gh-files')
      for (const f of pr.files) {
        const r = el('div', 'gh-file')
        r.append(el('span', 'gh-fname', f.path), el('span', 'gh-add', `+${f.additions}`), el('span', 'gh-del', `−${f.deletions}`))
        files.append(r)
      }
      box.append(files)
    }
    if (pr.reviews.length) {
      box.append(el('h3', '', 'Reviews'))
      for (const r of pr.reviews) box.append(el('div', 'gh-review', `${r.author}: ${r.state.toLowerCase().replace('_', ' ')}${r.body ? ` — ${r.body}` : ''}`))
    }
    if (pr.comments.length) {
      box.append(el('h3', '', 'Comments'))
      for (const c of pr.comments) {
        const x = el('div', 'gh-comment')
        x.append(el('div', 'gh-comment-head', `${c.author} · ${ago(c.createdAt)}`))
        const md = el('div', 'md-body')
        md.innerHTML = DOMPurify.sanitize(marked.parse(c.body, { gfm: true, async: false }) as string)
        x.append(md)
        box.append(x)
      }
    }
    return box
  }

  async function refresh(): Promise<void> {
    const mine = ++seq
    const root = d.getRoot()
    if (!root) {
      repoEl.textContent = ''
      newBtn.disabled = true
      hint(list, 'Open a project to see its pull requests.')
      detail.replaceChildren()
      return
    }
    const status = await window.forge.ghStatus(root)
    if (mine !== seq) return
    repoEl.textContent = status.repo ?? ''
    newBtn.disabled = !status.repo
    if (!status.repo) {
      hint(list, status.message, !status.installed || !status.loggedIn)
      detail.replaceChildren()
      return
    }
    hint(list, 'Loading…')
    let prs: PrSummary[]
    try {
      prs = await window.forge.ghList(root, stateSel.value as State)
    } catch (err) {
      if (mine === seq) hint(list, err instanceof Error ? err.message : String(err), true)
      return
    }
    if (mine !== seq) return
    if (!prs.length) {
      hint(list, `No ${stateSel.value === 'all' ? '' : `${stateSel.value} `}pull requests.`)
      detail.replaceChildren()
      return
    }
    list.replaceChildren(...prs.map(row))
    if (selected !== null && prs.some((p) => p.number === selected)) void showDetail(selected)
    else {
      selected = null
      hint(detail, 'Select a pull request.')
    }
  }

  stateSel.onchange = () => {
    selected = null
    void refresh()
  }
  refreshBtn.onclick = () => void refresh()
  newBtn.onclick = () => {
    const root = d.getRoot()
    if (!root) return
    void run('New pull request', async () => {
      const prTitle = await askText('Pull request title')
      if (prTitle === null || !prTitle.trim()) return
      const prBody = (await askText('Description (optional)')) ?? ''
      const url = await window.forge.ghCreate(root, { title: prTitle.trim(), body: prBody })
      d.report(`Created ${url}`)
      await refresh()
    })
  }

  return { refresh }
}
