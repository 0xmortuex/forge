// @ts-check
// Runs every scenario in its own Electron process and reports a combined result.
// Usage: node tests/run-all.cjs [scenario ...]     (build first: `pnpm build`, or just `pnpm test`)
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const electron = /** @type {string} */ (/** @type {unknown} */ (require('electron')))
const dir = path.join(__dirname, 'scenarios')
const wanted = process.argv.slice(2)
// A hung scenario must fail by name instead of stalling the whole run (the slowest takes about half a minute).
const SCENARIO_TIMEOUT_MS = 180000
const scenarios = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.cjs'))
  .filter((f) => !wanted.length || wanted.includes(path.basename(f, '.cjs')))

if (!scenarios.length) {
  console.error('No matching scenarios')
  process.exit(1)
}

let failed = 0
for (const file of scenarios) {
  const res = spawnSync(electron, [path.join(dir, file)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SCENARIO_TIMEOUT_MS, killSignal: 'SIGKILL' })
  // Chromium prints harmless GPU/network-service noise on stderr; only our PASS/FAIL lines matter.
  const lines = res.stdout.split('\n').filter((l) => /^(PASS|FAIL|OK|FAILED) /.test(l))
  console.log(lines.join('\n'))
  if (res.status !== 0 || !lines.some((l) => l.startsWith('OK '))) {
    failed++
    if (!lines.some((l) => l.startsWith('FAIL'))) console.log(`FAILED ${file}: exited ${res.status}${res.error ? ` (${res.error.message})` : ''} without a result\n${res.stderr.slice(-600)}`)
  }
}
console.log(failed ? `\n${failed} scenario(s) failed` : `\nAll ${scenarios.length} scenarios passed`)
process.exit(failed ? 1 : 0)
