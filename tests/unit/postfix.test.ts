import assert from 'node:assert/strict'
import test from 'node:test'
import { expressionStart, postfixAt, POSTFIX_LANGUAGES } from '../../src/renderer/postfixcore'

const at = (language: string, line: string, typed?: string) => postfixAt(language, line, line.length).filter((m) => (typed ? m.key === typed : true))

test('a simple identifier is the expression', () => {
  const [m] = at('typescript', 'user.log', 'log')
  assert.equal(m?.expression, 'user')
  assert.equal(m?.snippet, 'console.log(user)')
  assert.equal(m?.start, 0)
})

test('member access, calls and indexing belong to the expression', () => {
  assert.equal(at('javascript', 'a.b.c.log', 'log')[0]?.expression, 'a.b.c')
  assert.equal(at('javascript', 'getUser(1).name.log', 'log')[0]?.expression, 'getUser(1).name')
  assert.equal(at('javascript', 'rows[i].log', 'log')[0]?.expression, 'rows[i]')
  assert.equal(at('javascript', 'f(g(1), 2).log', 'log')[0]?.expression, 'f(g(1), 2)')
})

test('strings are part of the expression, with their dots', () => {
  assert.equal(at('javascript', 'const x = "a.b".log', 'log')[0]?.expression, '"a.b"')
})

test('only the expression is taken, not what is before it', () => {
  const m = at('typescript', '  const total = items.for', 'for')[0]
  assert.equal(m?.expression, 'items')
  assert.equal(m?.start, '  const total = '.length)
})

test('the typed keyword filters the templates', () => {
  const keys = at('typescript', 'x.fo').map((m) => m.key)
  assert.deepEqual(keys.sort(), ['for', 'foreach', 'fori'])
  assert.deepEqual(at('typescript', 'x.nothing'), [])
})

test('all templates are offered right after the dot', () => {
  assert.ok(at('typescript', 'x.').length >= 15)
})

test('a number is not a receiver', () => {
  assert.deepEqual(at('typescript', '1.'), [])
  assert.deepEqual(at('typescript', 'x = 3.5.'), [])
})

test('nothing before the dot, or no dot, means no templates', () => {
  assert.deepEqual(at('typescript', '.log'), [])
  assert.deepEqual(at('typescript', 'log'), [])
})

test('Python templates follow Python syntax', () => {
  assert.equal(at('python', 'name.print', 'print')[0]?.snippet, 'print(name)')
  assert.equal(at('python', 'rows.for', 'for')[0]?.snippet, 'for ${1:item} in rows:\n\t$0')
  assert.equal(at('python', 'v.none', 'none')[0]?.snippet, 'if v is None:\n\t$0')
})

test('languages without templates get none', () => {
  assert.deepEqual(postfixAt('plaintext', 'x.log', 4), [])
  assert.deepEqual(postfixAt('markdown', 'x.log', 4), [])
})

test('a $ in the expression is escaped, so the snippet inserts it literally', () => {
  assert.equal(at('javascript', '$el.log', 'log')[0]?.expression, '$el')
  assert.equal(at('javascript', '$el.log', 'log')[0]?.snippet, 'console.log(\\$el)')
})

test('every language has templates with unique keys and a snippet that uses the expression', () => {
  for (const lang of POSTFIX_LANGUAGES) {
    const all = postfixAt(lang, 'x.', 2)
    assert.ok(all.length > 5, `${lang} has few templates`)
    assert.equal(new Set(all.map((m) => m.key)).size, all.length, `${lang} repeats a key`)
    for (const m of all) assert.ok(m.snippet.includes('x'), `${lang}.${m.key} ignores the expression`)
  }
})

test('expressionStart handles unbalanced brackets without looping', () => {
  assert.equal(expressionStart('foo)bar.', 7), 4)
  assert.equal(expressionStart(')', 1), 1)
})
