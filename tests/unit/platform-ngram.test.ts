import assert from 'node:assert/strict'
import test from 'node:test'
import { familyOf, LocalModel, MAX_FILE_CHARS, parsePrefix, tokenize } from '../../src/main/platform/ngram'

const lines = (...l: string[]): string => l.join('\n') + '\n'

test('symbols keep a leading space where there was whitespace, drop indentation, and end lines with a newline symbol', () => {
  assert.deepEqual(tokenize('const x = 1\n  foo(a, "b c")'), ['const', ' x', ' =', ' 1', '\n', 'foo', '(', 'a', ',', ' "b c"', ')', '\n'])
  assert.deepEqual(tokenize('a === b && c => d'), ['a', ' ===', ' b', ' &&', ' c', ' =>', ' d', '\n'])
  assert.deepEqual(tokenize('\n\n   \nx\n'), ['x', '\n'], 'blank lines vanish')
  assert.deepEqual(tokenize(`s = 'it\\'s'`), ['s', ' =', " 'it\\'s'", '\n'], 'an escaped quote does not end the string')
})

test('joining the symbols gives back the code of a line', () => {
  const line = 'return map.get(key) ?? fallback(1, "two")'
  assert.equal(tokenize(line).slice(0, -1).join(''), line)
})

test('the prefix is split into context, the word being typed, and trailing space', () => {
  assert.deepEqual(parsePrefix('const user = await fetch'), { context: ['const', ' user', ' =', ' await'], partial: ' fetch', trailingSpace: false })
  assert.deepEqual(parsePrefix('const user = await '), { context: ['const', ' user', ' =', ' await'], partial: null, trailingSpace: true })
  assert.deepEqual(parsePrefix('foo('), { context: ['foo', '('], partial: null, trailingSpace: false })
  assert.deepEqual(parsePrefix('print("hel'), { context: ['print', '('], partial: '"hel', trailingSpace: false }, 'an unfinished string is the word being typed')
  assert.deepEqual(parsePrefix('a = 1\nb'), { context: ['a', ' =', ' 1', '\n'], partial: 'b', trailingSpace: false })
})

test('files of related languages share a model, others do not', () => {
  assert.equal(familyOf('/p/a.ts'), 'js')
  assert.equal(familyOf('/p/b.JSX'), 'js')
  assert.equal(familyOf('/p/c.py'), 'py')
  assert.equal(familyOf('/p/Makefile'), 'text')
  assert.equal(familyOf('/p/x.toml'), 'toml')
})

function trained(): LocalModel {
  const m = new LocalModel()
  m.train('/p/a.ts', lines('const user = await fetchUser(id)', 'const user = await fetchUser(id)', 'const user = await fetchUser(id)', 'const items = await fetchItems(id)', 'console.log("hello world")', 'console.log("hello world")'))
  return m
}

test('it finishes a half-typed word and the rest of the line', () => {
  const s = trained().suggest('/p/b.ts', 'const user = await fetch')
  assert.equal(s?.text, 'User(id)')
  assert.ok(s && s.confidence >= 0.5 && s.confidence <= 1)
})

test('after a space it continues with the next word, without doubling the space', () => {
  assert.equal(trained().suggest('/p/b.ts', 'const user = await ')?.text, 'fetchUser(id)')
})

test('it completes inside a string the project writes the same way every time', () => {
  assert.equal(trained().suggest('/p/b.ts', 'console.log("hel')?.text, 'lo world")')
})

test('it stays silent when it is not sure: ambiguous, unseen, or too little to go on', () => {
  const m = new LocalModel()
  m.train('/p/a.ts', lines('x = 1', 'x = 2', 'x = 3', 'x = 4'))
  assert.equal(m.suggest('/p/a.ts', 'x ='), null, 'four equally likely continuations')
  assert.equal(trained().suggest('/p/b.ts', 'zzz qqq '), null, 'symbols it has never seen')
  const once = new LocalModel()
  once.train('/p/a.ts', lines('only(once)'))
  assert.equal(once.suggest('/p/a.ts', 'only('), null, 'seen once is not evidence')
})

test('a model is per language family', () => {
  const m = new LocalModel()
  m.train('/p/a.py', lines('print(value)', 'print(value)', 'print(value)'))
  assert.equal(m.suggest('/p/b.py', 'print(')?.text, 'value)')
  assert.equal(m.suggest('/p/c.ts', 'print('), null)
})

test('a file that changes is relearned, and a deleted one is forgotten without a trace', () => {
  const m = new LocalModel()
  m.train('/p/a.ts', lines('run(alpha)', 'run(alpha)', 'run(alpha)'))
  assert.equal(m.suggest('/p/a.ts', 'run(')?.text, 'alpha)')
  m.train('/p/a.ts', lines('run(beta)', 'run(beta)', 'run(beta)'))
  assert.equal(m.suggest('/p/a.ts', 'run(')?.text, 'beta)', 'the old version no longer counts')
  m.forget('/p/a.ts')
  assert.equal(m.suggest('/p/a.ts', 'run('), null)
  assert.deepEqual(m.stats(), { files: 0, symbols: 0, contexts: 0 }, 'every count was taken back')
})

test('two files that teach the same thing support each other, and forgetting one keeps the other', () => {
  const m = new LocalModel()
  m.train('/p/a.ts', lines('go(fast)', 'go(fast)'))
  m.train('/p/b.ts', lines('go(fast)', 'go(fast)'))
  m.forget('/p/a.ts')
  assert.equal(m.suggest('/p/c.ts', 'go(')?.text, 'fast)')
})

test('very long strings end a suggestion instead of being offered', () => {
  const long = '"' + 'x'.repeat(100) + '"'
  const m = new LocalModel()
  m.train('/p/a.ts', lines(`say(${long})`, `say(${long})`, `say(${long})`))
  assert.equal(m.suggest('/p/a.ts', 'say('), null)
})

test('a file that is too large is not learned from', () => {
  const m = new LocalModel()
  assert.equal(m.train('/p/big.ts', 'a = 1\n'.repeat(MAX_FILE_CHARS / 4)), 'too-large')
  assert.equal(m.stats().files, 0)
})
