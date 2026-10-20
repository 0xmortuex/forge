import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ago, checksState, detailPr, reviewState, summarizePr } from '../../src/main/ghparse'

test('checks: any failure fails, unfinished is pending, all green passes, none is none', () => {
  assert.equal(checksState(undefined), 'none')
  assert.equal(checksState([]), 'none')
  assert.equal(checksState([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]), 'pass')
  assert.equal(checksState([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }]), 'fail')
  assert.equal(checksState([{ status: 'IN_PROGRESS', conclusion: '' }, { status: 'COMPLETED', conclusion: 'SUCCESS' }]), 'pending')
  assert.equal(checksState([{ state: 'PENDING' }]), 'pending')
  assert.equal(checksState([{ status: 'COMPLETED', conclusion: 'SKIPPED' }, { status: 'COMPLETED', conclusion: 'NEUTRAL' }]), 'pass')
  assert.equal(checksState([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'TIMED_OUT' }]), 'fail', 'a failure wins over a pending check')
})

test('review decisions map to short states', () => {
  assert.equal(reviewState('APPROVED'), 'approved')
  assert.equal(reviewState('CHANGES_REQUESTED'), 'changes')
  assert.equal(reviewState('REVIEW_REQUIRED'), 'required')
  assert.equal(reviewState(''), 'none')
  assert.equal(reviewState(null), 'none')
})

test('a pull request summary tolerates missing fields', () => {
  const pr = summarizePr({ number: 7, title: 'Fix it', author: { login: 'ada' }, headRefName: 'fix', baseRefName: 'main', isDraft: true, state: 'OPEN', url: 'u' })
  assert.equal(pr.number, 7)
  assert.equal(pr.author, 'ada')
  assert.equal(pr.draft, true)
  assert.equal(pr.state, 'open')
  assert.equal(pr.checks, 'none')
  assert.equal(summarizePr({ state: 'MERGED' }).state, 'merged')
  assert.equal(summarizePr({ state: 'CLOSED' }).state, 'closed')
  assert.equal(summarizePr(null).author, 'unknown')
})

test('details carry files, comments and reviews', () => {
  const d = detailPr({
    number: 1,
    body: 'text',
    additions: 5,
    deletions: 2,
    files: [{ path: 'a.ts', additions: 5, deletions: 2 }],
    comments: [{ author: { login: 'bob' }, body: 'hi', createdAt: '2026-01-01T00:00:00Z' }],
    reviews: [{ author: { login: 'eve' }, state: 'APPROVED', body: '' }],
    mergeable: 'MERGEABLE'
  })
  assert.deepEqual(d.files, [{ path: 'a.ts', additions: 5, deletions: 2 }])
  assert.equal(d.comments[0]?.author, 'bob')
  assert.equal(d.reviews[0]?.state, 'APPROVED')
  assert.equal(d.mergeable, 'MERGEABLE')
})

test('ago reads naturally', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  assert.equal(ago('2026-10-20T11:59:50Z', now), 'just now')
  assert.equal(ago('2026-10-20T11:30:00Z', now), '30 minutes ago')
  assert.equal(ago('2026-10-20T11:00:00Z', now), '1 hour ago')
  assert.equal(ago('2026-10-18T12:00:00Z', now), '2 days ago')
  assert.equal(ago('nonsense', now), '')
})
