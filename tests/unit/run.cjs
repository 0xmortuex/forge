// @ts-check
// Runs the unit tests (tests/unit/*.test.ts): plain Node test files that import the TypeScript sources directly through tsx.
// No window is opened. Usage: node tests/unit/run.cjs [name ...]     (or: pnpm test:unit)
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const wanted = process.argv.slice(2)
const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !wanted.length || wanted.some((w) => f.startsWith(w)))
  .map((f) => path.join(__dirname, f))

if (!files.length) {
  console.error('No unit tests found')
  process.exit(1)
}

const res = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...files], { stdio: 'inherit' })
process.exit(res.status ?? 1)
