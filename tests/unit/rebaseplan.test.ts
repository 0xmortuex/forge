import assert from 'node:assert/strict'
import test from 'node:test'
import { planProblem, planTodo, withExecLines, type RebaseStep } from '../../src/main/rebaseplan'

const step = (sha: string, action: RebaseStep['action'], original = `message of ${sha}`, message?: string): RebaseStep => ({ sha, action, original, message })
const paths = (n: number): string => `C:/repo/.git/forge-rebase/msg-${n}.txt`

test('picks become pick lines in order', () => {
  const { todo, messages } = planTodo([step('aaaaaaa', 'pick'), step('bbbbbbb', 'pick')])
  assert.equal(todo, 'pick aaaaaaa\npick bbbbbbb\n')
  assert.deepEqual(messages, [])
})

test('drop is written as a drop line', () => {
  assert.equal(planTodo([step('aaaaaaa', 'pick'), step('bbbbbbb', 'drop')]).todo, 'pick aaaaaaa\ndrop bbbbbbb\n')
})

test('reword is a pick followed by an amend with the new message', () => {
  const { todo, messages } = planTodo([step('aaaaaaa', 'reword', 'old', 'new message')])
  assert.equal(todo, 'pick aaaaaaa\nMESSAGE:1\n')
  assert.deepEqual(messages, [{ n: 1, text: 'new message\n' }])
  assert.equal(withExecLines(todo, paths), `pick aaaaaaa\nexec git commit --amend -q -F "${paths(1)}"\n`)
})

test('fixup folds into the commit above and keeps its message', () => {
  const { todo, messages } = planTodo([step('aaaaaaa', 'pick'), step('bbbbbbb', 'fixup')])
  assert.equal(todo, 'pick aaaaaaa\nfixup bbbbbbb\n')
  assert.deepEqual(messages, [])
})

test('squash joins the messages by default, after the chain', () => {
  const { todo, messages } = planTodo([step('aaaaaaa', 'pick', 'first'), step('bbbbbbb', 'squash', 'second'), step('ccccccc', 'fixup', 'third')])
  assert.equal(todo, 'pick aaaaaaa\nfixup bbbbbbb\nfixup ccccccc\nMESSAGE:1\n')
  assert.equal(messages[0]?.text, 'first\n\nsecond\n') // the fixup's message is thrown away
})

test('an edited message for a squashed chain wins over the default', () => {
  const { messages } = planTodo([step('aaaaaaa', 'pick', 'first', 'chosen text'), step('bbbbbbb', 'squash', 'second')])
  assert.equal(messages[0]?.text, 'chosen text\n')
})

test('a dropped commit between a commit and its squash does not break the chain', () => {
  const { todo } = planTodo([step('aaaaaaa', 'pick'), step('bbbbbbb', 'drop'), step('ccccccc', 'squash')])
  assert.equal(todo, 'pick aaaaaaa\ndrop bbbbbbb\nfixup ccccccc\nMESSAGE:1\n')
})

test('two chains get their own messages', () => {
  const { todo, messages } = planTodo([step('aaaaaaa', 'pick', 'a'), step('bbbbbbb', 'squash', 'b'), step('ccccccc', 'pick', 'c'), step('ddddddd', 'squash', 'd')])
  assert.equal(messages.length, 2)
  assert.equal(todo, 'pick aaaaaaa\nfixup bbbbbbb\nMESSAGE:1\npick ccccccc\nfixup ddddddd\nMESSAGE:2\n')
})

test('plans that cannot work are refused with a reason', () => {
  assert.match(planProblem([])!, /no commits/)
  assert.match(planProblem([step('aaaaaaa', 'drop')])!, /nothing would be left/)
  assert.match(planProblem([step('aaaaaaa', 'squash'), step('bbbbbbb', 'pick')])!, /cannot be "squash"/)
  assert.match(planProblem([step('aaaaaaa', 'drop'), step('bbbbbbb', 'fixup'), step('ccccccc', 'pick')])!, /cannot be "fixup"/)
  assert.match(planProblem([step('aaaaaaa', 'reword', 'x', '   ')])!, /needs a new message/)
  assert.match(planProblem([step('not a sha!', 'pick')])!, /Not a commit id/)
  assert.equal(planProblem([step('aaaaaaa', 'pick'), step('bbbbbbb', 'squash')]), null)
})

test('planTodo throws the same reason', () => {
  assert.throws(() => planTodo([]), /no commits/)
})
