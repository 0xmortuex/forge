import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

// Scripted edits once left raw control characters and invalid UTF-8 (SOH, NUL...) inside source files after a backslash was eaten.
// They compile, then misbehave. Nothing but tab, newline and carriage return may appear in the sources.

const ROOTS = ['src', 'tests', 'docs', 'examples']
const EXTENSIONS = new Set(['.ts', '.cjs', '.js', '.json', '.css', '.html', '.md', '.svg'])

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (EXTENSIONS.has(extname(name))) yield path
  }
}

test('no source file contains stray control characters', () => {
  const bad: string[] = []
  for (const root of ROOTS) {
    for (const file of files(root)) {
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file)) // a patch script once wrote a lone 0x85 for an ellipsis
      } catch {
        bad.push(`${file}: not valid UTF-8`)
        continue
      }
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i)
        if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
          bad.push(`${file}: U+${c.toString(16).padStart(4, '0')} at line ${text.slice(0, i).split('\n').length}`)
          break
        }
      }
    }
  }
  assert.deepEqual(bad, [])
})
