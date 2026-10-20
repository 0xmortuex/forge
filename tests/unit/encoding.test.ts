import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decode, detectEncoding, encode, ENCODINGS } from '../../src/main/encoding'

test('a BOM decides the encoding', () => {
  assert.equal(detectEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), 'utf8bom')
  assert.equal(detectEncoding(Buffer.from([0xff, 0xfe, 0x61, 0x00])), 'utf16le')
  assert.equal(detectEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x61])), 'utf16be')
})

test('valid UTF-8 is UTF-8, anything else is Windows-1252', () => {
  assert.equal(detectEncoding(Buffer.from('héllo ş', 'utf8')), 'utf8')
  assert.equal(detectEncoding(Buffer.from('plain ascii')), 'utf8')
  assert.equal(detectEncoding(Buffer.from([0x63, 0x61, 0x66, 0xe9])), 'windows-1252') // "café" in Latin-1
  assert.equal(detectEncoding(Buffer.alloc(0)), 'utf8')
})

test('every listed encoding round-trips text it can represent', () => {
  for (const e of ENCODINGS) {
    const sample = ['utf8', 'utf8bom', 'utf16le', 'utf16be'].includes(e.id) ? 'héllo ş € 日本' : 'hello abc 123'
    assert.equal(decode(encode(sample, e.id), e.id), sample, e.id)
  }
})

test('Latin-1 bytes decode to the right characters', () => {
  assert.equal(decode(Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'windows-1252'), 'café')
  assert.equal(decode(Buffer.from([0xfd, 0xde, 0xf0]), 'windows-1254'), 'ıŞğ')
})

test('UTF-16 and UTF-8 BOMs are written, and never end up in the text', () => {
  assert.deepEqual([...encode('a', 'utf16le')], [0xff, 0xfe, 0x61, 0x00])
  assert.deepEqual([...encode('a', 'utf8bom')], [0xef, 0xbb, 0xbf, 0x61])
  assert.equal(decode(encode('a', 'utf16be'), 'utf16be'), 'a')
  assert.equal(decode(encode('a', 'utf8bom'), 'utf8bom'), 'a')
})

test('text the encoding cannot hold is an error, not a "?"', () => {
  assert.throws(() => encode('price: 5€', 'iso-8859-1'), /cannot be saved as ISO-8859-1.*U\+20AC/)
  assert.throws(() => encode('日本', 'windows-1252'), /cannot be saved/)
  assert.equal(decode(encode('price: 5€', 'windows-1252'), 'windows-1252'), 'price: 5€')
})

test('an unknown encoding is refused', () => {
  assert.throws(() => decode(Buffer.from('a'), 'klingon'), /Unsupported encoding/)
  assert.throws(() => encode('a', 'klingon'), /Unsupported encoding/)
})
