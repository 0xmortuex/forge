import type { PtySpec } from '../main/terminal'
import { icons } from './icons'
import { showMenu, type MenuItem } from './menu'
import type { TerminalView } from './terminal'

export type ConfigType = 'current-file' | 'node' | 'python' | 'command'

export interface RunConfig {
  name: string
  type: ConfigType
  program?: string // node / python: script path, relative to the project
  command?: string // command: shell command line
  args?: string[]
  cwd?: string // relative to the project; default is the project folder
  env?: Record<string, string>
}

export interface ResolvedRun {
  label: string
  spec: PtySpec
  cwd: string
  /** Set when this configuration can be debugged: which debug backend to start it with. */
  debugKind?: 'node' | 'python'
}

export interface RunDeps {
  getRoot: () => string | null
  getActivePath: () => string | null
  saveAll: () => Promise<void>
  report: (msg: string, isError?: boolean) => void
  guard: (label: string, fn: () => Promise<void>) => Promise<void>
  openFile: (path: string) => Promise<void>
  view: TerminalView
  showRunView: () => void
}

const CONFIG_DIR = '.forge'
const CONFIG_FILE = 'run.json'

const CURRENT_FILE: RunConfig = { name: 'Current File', type: 'current-file' }

const TEMPLATE = `{
  "configurations": [
    { "name": "Current File", "type": "current-file" },
    { "name": "Run script", "type": "node", "program": "index.js", "args": [] },
    { "name": "Python script", "type": "python", "program": "main.py", "args": [] },
    { "name": "Dev server", "type": "command", "command": "pnpm dev" }
  ]
}
`

// macOS and most Linux distributions ship `python3` and no bare `python`.
const PYTHON = navigator.platform.startsWith('Win') ? 'python' : 'python3'

const NODE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']
const TYPES: ConfigType[] = ['current-file', 'node', 'python', 'command']

const sepOf = (p: string): string => (p.includes('\\') ? '\\' : '/')
const isAbs = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')
const joinTo = (root: string, rel: string): string => (isAbs(rel) ? rel : `${root}${sepOf(root)}${rel}`)
const extOf = (p: string): string => {
  const base = p.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

/** Parses and validates .forge/run.json, with errors that name the offending entry. */
export function parseConfigs(text: string): RunConfig[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`${CONFIG_DIR}/${CONFIG_FILE} is not valid JSON: ${(err as Error).message}`)
  }
  const list = (data as { configurations?: unknown } | null)?.configurations
  if (!Array.isArray(list)) throw new Error(`${CONFIG_DIR}/${CONFIG_FILE}: expected a "configurations" array`)
  return list.map((raw, i) => {
    const c = raw as Partial<RunConfig>
    const where = `${CONFIG_DIR}/${CONFIG_FILE}: configuration #${i + 1}`
    if (!c || typeof c.name !== 'string' || !c.name) throw new Error(`${where} needs a "name"`)
    if (!TYPES.includes(c.type as ConfigType)) {
      throw new Error(`${where} ("${c.name}") has type "${String(c.type)}"; expected one of ${TYPES.join(', ')}`)
    }
    if ((c.type === 'node' || c.type === 'python') && !c.program) throw new Error(`${where} ("${c.name}") needs a "program"`)
    if (c.type === 'command' && !c.command) throw new Error(`${where} ("${c.name}") needs a "command"`)
    return c as RunConfig
  })
}

/** Turns a configuration into the process to start. Throws a clear error for anything unrunnable. */
export function resolveConfig(cfg: RunConfig, root: string, activePath: string | null, debug: boolean): ResolvedRun {
  let type: ConfigType = cfg.type
  let program = cfg.program
  if (type === 'current-file') {
    if (!activePath) throw new Error('No file is open to run — open a file or pick another configuration')
    const ext = extOf(activePath)
    if (NODE_EXTS.includes(ext)) type = 'node'
    else if (ext === '.py') type = 'python'
    else throw new Error(`Don't know how to run ${ext || 'extensionless'} files (supported: ${[...NODE_EXTS, '.py'].join(' ')})`)
    program = activePath
  }
  const cwd = cfg.cwd ? joinTo(root, cfg.cwd) : root
  const env = cfg.env
  const args = cfg.args ?? []
  if (type === 'node') {
    const file = joinTo(root, program ?? '')
    return {
      label: `${cfg.name} (node)`,
      cwd,
      debugKind: 'node',
      spec: { file: 'node', args: [...(debug ? ['--inspect-brk=127.0.0.1:0'] : []), file, ...args], env }
    }
  }
  if (type === 'python') {
    // For debugging, the main process wraps this in `-m debugpy --listen …`.
    return {
      label: `${cfg.name} (python)`,
      cwd,
      debugKind: 'python',
      spec: { file: PYTHON, args: ['-u', joinTo(root, program ?? ''), ...args], env }
    }
  }
  if (debug) throw new Error('Debugging command configurations is not supported — use a node or python configuration')
  const command = cfg.command ?? ''
  const shell: PtySpec =
    navigator.platform.startsWith('Win')
      ? { file: 'powershell.exe', args: ['-NoProfile', '-Command', command], env }
      : { file: 'sh', args: ['-c', command], env }
  return { label: `${cfg.name} (command)`, cwd, spec: shell }
}

export function initRun(deps: RunDeps): {
  /** Resolves the selected configuration for starting (debug=true adds the inspector flag). */
  resolveSelected: (debug: boolean) => Promise<ResolvedRun>
  /** Starts the selected configuration in the Run tab. */
  run: () => Promise<void>
  stop: () => Promise<void>
  updateButtons: () => void
  /** Called by whoever owns the process (run or debug) when running state changes. */
  setBusy: (busy: boolean) => void
} {
  const nameEl = document.getElementById('run-config-name')
  const widget = document.getElementById('run-config')
  const runBtn = document.getElementById('run-btn') as HTMLButtonElement | null
  const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement | null
  const chev = document.getElementById('run-config-chev')
  if (!nameEl || !widget || !runBtn || !stopBtn || !chev) throw new Error('Run toolbar elements missing from index.html')
  chev.innerHTML = icons.chevronDown
  runBtn.innerHTML = icons.play
  stopBtn.innerHTML = icons.stop

  let configs: RunConfig[] = [CURRENT_FILE]
  let selected: RunConfig = CURRENT_FILE
  let busy = false

  const configPath = (root: string): string => joinTo(root, `${CONFIG_DIR}${sepOf(root)}${CONFIG_FILE}`)

  async function loadConfigs(): Promise<void> {
    const root = deps.getRoot()
    if (!root) throw new Error('Open a folder first (Ctrl+O)')
    const path = configPath(root)
    const loaded = (await window.forge.exists(path)) ? parseConfigs(await window.forge.readFile(path)) : []
    configs = loaded.some((c) => c.type === 'current-file') ? loaded : [CURRENT_FILE, ...loaded]
    selected = configs.find((c) => c.name === selected.name) ?? configs[0] ?? CURRENT_FILE
    nameEl!.textContent = selected.name
  }

  async function resolveSelected(debug: boolean): Promise<ResolvedRun> {
    const root = deps.getRoot()
    if (!root) throw new Error('Open a folder first (Ctrl+O)')
    await loadConfigs() // re-read every time so edits to run.json apply immediately
    return resolveConfig(selected, root, deps.getActivePath(), debug)
  }

  async function run(): Promise<void> {
    await deps.guard('Run', async () => {
      const resolved = await resolveSelected(false)
      await deps.saveAll()
      deps.showRunView()
      await deps.view.begin((cols, rows) => window.forge.termCreate(resolved.cwd, cols, rows, resolved.spec))
      deps.report(`Running ${resolved.label}`)
      updateButtons()
    })
  }

  async function stop(): Promise<void> {
    await deps.view.kill()
    updateButtons()
  }

  function updateButtons(): void {
    const running = busy || deps.view.isRunning()
    stopBtn!.disabled = !running
    runBtn!.disabled = running
  }

  async function editConfigs(): Promise<void> {
    const root = deps.getRoot()
    if (!root) throw new Error('Open a folder first (Ctrl+O)')
    const path = configPath(root)
    if (!(await window.forge.exists(path))) {
      const dir = joinTo(root, CONFIG_DIR)
      if (!(await window.forge.exists(dir))) await window.forge.createDir(dir)
      await window.forge.writeFile(path, TEMPLATE)
      deps.report(`Created ${path}`)
    }
    await deps.openFile(path)
  }

  widget.onclick = () => {
    void deps
      .guard('Run configurations', async () => {
        await loadConfigs()
        const rect = widget.getBoundingClientRect()
        const items: (MenuItem | 'sep')[] = configs.map((c) => ({
          label: (c === selected ? '● ' : '   ') + c.name,
          run: () => {
            selected = c
            nameEl.textContent = c.name
          }
        }))
        items.push('sep', { label: 'Edit Configurations…', run: () => void deps.guard('Edit configurations', editConfigs).catch(() => undefined) })
        showMenu(rect.left, rect.bottom + 4, items)
      })
      .catch(() => undefined) // reported by guard
  }
  runBtn.onclick = () => void run().catch(() => undefined) // reported by guard
  stopBtn.onclick = () => void stop()
  updateButtons()

  return {
    resolveSelected,
    run,
    stop,
    updateButtons,
    setBusy: (b) => {
      busy = b
      updateButtons()
    }
  }
}
