import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectDelimiter, filterRows, parseDelimited, sortRows } from '../../src/renderer/csv'
import { formatBytes, hexRows } from '../../src/renderer/hex'
import { parseNotebook } from '../../src/renderer/notebook'

test('CSV: quotes, embedded delimiters, newlines and doubled quotes', () => {
  const rows = parseDelimited('a,b,c\n"x,1","line1\nline2","say ""hi"""\n', ',')
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x,1', 'line1\nline2', 'say "hi"']])
})

test('CSV: CRLF, a missing final newline, empty cells and a BOM', () => {
  assert.deepEqual(parseDelimited('﻿a,b\r\n1,\r\n,2', ','), [['a', 'b'], ['1', ''], ['', '2']])
  assert.deepEqual(parseDelimited('', ','), [])
})

test('delimiter detection picks the one that splits every line the same way', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n'), ',')
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n'), ';')
  assert.equal(detectDelimiter('a\tb\n1\t2\n'), '\t')
  assert.equal(detectDelimiter('a|b|c\n1|2|3\n'), '|')
  assert.equal(detectDelimiter('anything', 'data.tsv'), '\t')
  assert.equal(detectDelimiter('just one column\nsecond'), ',')
})

test('sorting is numeric for numbers and natural for text, in both directions', () => {
  const rows = [['b', '10'], ['a', '9'], ['c', '100']]
  assert.deepEqual(sortRows(rows, 1, false).map((r) => r[1]), ['9', '10', '100'])
  assert.deepEqual(sortRows(rows, 1, true).map((r) => r[1]), ['100', '10', '9'])
  assert.deepEqual(sortRows(rows, 0, false).map((r) => r[0]), ['a', 'b', 'c'])
  assert.deepEqual(rows[0], ['b', '10'], 'the input is not reordered')
  assert.deepEqual(sortRows([['file10'], ['file2']], 0, false), [['file2'], ['file10']])
})

test('filtering matches any cell, ignoring case', () => {
  const rows = [['Alice', 'NY'], ['Bob', 'LA']]
  assert.deepEqual(filterRows(rows, 'ali'), [['Alice', 'NY']])
  assert.deepEqual(filterRows(rows, 'la'), [['Bob', 'LA']])
  assert.equal(filterRows(rows, '  ').length, 2)
})

test('hex rows: offsets, bytes and printable ASCII', () => {
  const data = new Uint8Array([0x48, 0x69, 0x00, 0xff, ...new Array(14).fill(0x41)])
  const rows = hexRows(data)
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.offset, '00000000')
  assert.deepEqual(rows[0]?.bytes.slice(0, 4), ['48', '69', '00', 'ff'])
  assert.equal(rows[0]?.ascii.slice(0, 4), 'Hi..')
  assert.equal(rows[1]?.offset, '00000010')
  assert.equal(rows[1]?.bytes.length, 2)
  assert.equal(hexRows(new Uint8Array([1]), 0x100)[0]?.offset, '00000100')
  assert.equal(formatBytes(1536), '1.5 KB')
})

test('notebook: cells, outputs, images and errors', () => {
  const nb = parseNotebook(
    JSON.stringify({
      metadata: { language_info: { name: 'python' } },
      cells: [
        { cell_type: 'markdown', source: ['# Title\n', 'text'] },
        { cell_type: 'code', execution_count: 3, source: 'print(1)', outputs: [{ output_type: 'stream', text: ['1\n'] }] },
        {
          cell_type: 'code',
          source: 'x',
          outputs: [
            { output_type: 'execute_result', data: { 'image/png': 'AAAA\nBBBB', 'text/plain': ['<img>'] } },
            { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: [String.fromCharCode(27) + '[31mValueError' + String.fromCharCode(27) + '[0m: bad'] }
          ]
        }
      ]
    })
  )
  assert.equal(nb.language, 'python')
  assert.equal(nb.cells.length, 3)
  assert.equal(nb.cells[0]?.source, '# Title\ntext')
  assert.equal(nb.cells[1]?.count, 3)
  assert.deepEqual(nb.cells[1]?.outputs, [{ kind: 'text', text: '1\n' }])
  assert.deepEqual(nb.cells[2]?.outputs[0], { kind: 'image', url: 'data:image/png;base64,AAAABBBB' })
  assert.deepEqual(nb.cells[2]?.outputs[1], { kind: 'text', text: 'ValueError: bad', error: true })
})

test('notebook: anything else is a readable error', () => {
  assert.throws(() => parseNotebook('{nope'), /Not a notebook/)
  assert.throws(() => parseNotebook('{"worksheets": []}'), /no "cells" list/)
  assert.throws(() => parseNotebook('[]'), /Not a notebook/)
})
