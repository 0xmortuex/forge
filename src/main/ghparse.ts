// Pull requests as `gh pr list/view --json` reports them, reduced to what the Pull Requests window shows. Pure, no I/O.

export type PrState = 'open' | 'closed' | 'merged'
export type ChecksState = 'pass' | 'fail' | 'pending' | 'none'
export type ReviewState = 'approved' | 'changes' | 'required' | 'none'

export interface PrSummary {
  number: number
  title: string
  author: string
  head: string
  base: string
  draft: boolean
  state: PrState
  updatedAt: string
  url: string
  review: ReviewState
  checks: ChecksState
}

export interface PrDetail extends PrSummary {
  body: string
  additions: number
  deletions: number
  files: { path: string; additions: number; deletions: number }[]
  comments: { author: string; body: string; createdAt: string }[]
  reviews: { author: string; state: string; body: string }[]
  mergeable: string
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const login = (v: unknown): string => str(obj(v)['login']) || 'unknown'

/** Check runs and commit statuses combined: any failure fails, any unfinished one is pending, otherwise they pass. */
export function checksState(rollup: unknown): ChecksState {
  if (!Array.isArray(rollup) || !rollup.length) return 'none'
  let pending = false
  for (const item of rollup) {
    const c = obj(item)
    const verdict = (str(c['conclusion']) || str(c['state'])).toUpperCase()
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(verdict)) return 'fail'
    if (str(c['status']).toUpperCase() !== 'COMPLETED' && c['status'] !== undefined) pending = true
    else if (['PENDING', 'EXPECTED', ''].includes(verdict)) pending = true
  }
  return pending ? 'pending' : 'pass'
}

export function reviewState(decision: unknown): ReviewState {
  switch (str(decision).toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes'
    case 'REVIEW_REQUIRED':
      return 'required'
    default:
      return 'none'
  }
}

export function summarizePr(raw: unknown): PrSummary {
  const p = obj(raw)
  const state = str(p['state']).toLowerCase()
  return {
    number: num(p['number']),
    title: str(p['title']),
    author: login(p['author']),
    head: str(p['headRefName']),
    base: str(p['baseRefName']),
    draft: p['isDraft'] === true,
    state: state === 'merged' ? 'merged' : state === 'closed' ? 'closed' : 'open',
    updatedAt: str(p['updatedAt']),
    url: str(p['url']),
    review: reviewState(p['reviewDecision']),
    checks: checksState(p['statusCheckRollup'])
  }
}

export function detailPr(raw: unknown): PrDetail {
  const p = obj(raw)
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  return {
    ...summarizePr(raw),
    body: str(p['body']),
    additions: num(p['additions']),
    deletions: num(p['deletions']),
    files: list(p['files']).map((f) => ({ path: str(obj(f)['path']), additions: num(obj(f)['additions']), deletions: num(obj(f)['deletions']) })),
    comments: list(p['comments']).map((c) => ({ author: login(obj(c)['author']), body: str(obj(c)['body']), createdAt: str(obj(c)['createdAt']) })),
    reviews: list(p['reviews']).map((r) => ({ author: login(obj(r)['author']), state: str(obj(r)['state']), body: str(obj(r)['body']) })),
    mergeable: str(p['mergeable'])
  }
}

/** "2 days ago" style age, from an ISO date. */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const units: [number, string][] = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [2592000, 'month'], [31536000, 'year']]
  let best: [number, string] = [60, 'minute']
  for (const u of units) if (s >= u[0]) best = u
  const n = Math.floor(s / best[0])
  return `${n} ${best[1]}${n === 1 ? '' : 's'} ago`
}
