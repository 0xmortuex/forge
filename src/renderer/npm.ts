import type { DepKind, Manager, NpmDep, NpmPackage, Outdated } from '../main/npm'

// The npm window: the project's package.json files, their scripts (run in a terminal tab) and their dependencies with the
// installed and latest versions (update or remove with the project's own package manager).

export interface NpmDeps {
  /** The window's own root element. */
  root: HTMLElement
  getRoot: () => string | null
  /** Runs a command line in a new terminal tab started in `cwd`. */
  runCommand: (cwd: string, command: string, title: string) => void
  /** Opens a file in the editor. */
  openFile: (path: string) => Promise<void>
  /** Brings the window on screen. */
  reveal: () => void
  report: (msg: string, isError?: boolean) => void
}

export interface NpmView {
  refresh: () => Promise<void>
}

const KIND_TITLE: Record<DepKind, string> = {
  dependencies: 'Dependencies',
  devDependencies: 'Dev dependencies',
  peerDependencies: 'Peer dependencies',
  optionalDependencies: 'Optional dependencies'
}

/** A name safe to put on a command line as it is; anything else is quoted. */
const arg = (s: string): string => (/^[\w@/:.+-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`)

export type NpmAction = 'install' | 'run' | 'update' | 'remove'

/** The command line for an action with the project's package manager. */
export function commandFor(manager: Manager, action: NpmAction, name = '', kind: DepKind = 'dependencies'): string {
  const dev = kind === 'devDependencies'
  switch (action) {
    case 'install':
      return `${manager} install`
    case 'run':
      return `${manager} run ${arg(name)}`
    case 'update':
      if (manager === 'npm') return `npm install ${arg(name)}@latest${dev ? ' -D' : ''}`
      return `${manager} add ${arg(name)}@latest${dev ? (manager === 'bun' ? ' -d' : ' -D') : ''}`
    case 'remove':
      return manager === 'npm' ? `npm uninstall ${arg(name)}` : `${manager} remove ${arg(name)}`
  }
}

export function initNpm(d: NpmDeps): NpmView {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  const bar = el('div', 'tool-bar npm-bar')
  const pick = el('select', 'field npm-pkg')
  pick.id = 'npm-pkg'
  const manager = el('span', 'npm-manager')
  manager.id = 'npm-manager'
  const status = el('span', 'npm-status')
  status.id = 'npm-status'
  const install = el('button', 'btn', 'Install')
  install.id = 'npm-install'
  install.title = 'Install the dependencies'
  const outdated = el('button', 'btn', 'Check for Updates')
  outdated.id = 'npm-outdated'
  const refresh = el('button', 'btn', 'Refresh')
  refresh.id = 'npm-refresh'
  const edit = el('button', 'btn', 'package.json')
  edit.id = 'npm-edit'
  bar.append(pick, manager, status, install, outdated, refresh, edit)
  const body = el('div', 'tool-list npm-body')
  body.id = 'npm-body'
  d.root.replaceChildren(bar, body)

  let packages: NpmPackage[] = []
  let current = 0
  let latest: Record<string, Outdated> = {} // by package dir, then merged by name below
  const checked = new Set<string>() // package dirs whose update check has run
  const results = new Map<string, Record<string, Outdated>>()

  const pkg = (): NpmPackage | undefined => packages[current]
  const run = (cwd: string, command: string, title: string): void => {
    d.reveal()
    d.runCommand(cwd, command, title)
  }

  function draw(): void {
    body.replaceChildren()
    pick.replaceChildren()
    packages.forEach((p, i) => {
      const o = el('option', '', p.rel === '.' ? `${p.name} (root)` : `${p.name} (${p.rel})`)
      o.value = String(i)
      pick.append(o)
    })
    pick.value = String(current)
    pick.hidden = packages.length < 2
    const p = pkg()
    for (const b of [install, outdated, edit]) b.disabled = !p || !!p.error
    if (!p) {
      manager.textContent = ''
      body.append(el('div', 'hint', d.getRoot() ? 'No package.json in this project.' : 'Open a folder first (Ctrl+O).'))
      return
    }
    manager.textContent = p.manager
    if (p.error) {
      body.append(el('div', 'hint err', p.error))
      return
    }
    latest = results.get(p.dir) ?? {}

    body.append(el('div', 'npm-section', `Scripts (${p.scripts.length})`))
    if (!p.scripts.length) body.append(el('div', 'hint', 'This package.json has no scripts.'))
    for (const s of p.scripts) {
      const row = el('div', 'npm-script')
      row.dataset['script'] = s.name
      const go = el('button', 'icon-btn small npm-run', '▶')
      go.title = `${commandFor(p.manager, 'run', s.name)}`
      go.onclick = () => run(p.dir, commandFor(p.manager, 'run', s.name), `${p.manager}: ${s.name}`)
      row.append(go, el('span', 'npm-script-name', s.name), el('span', 'npm-script-cmd', s.command))
      row.ondblclick = () => go.click()
      body.append(row)
    }

    for (const kind of Object.keys(KIND_TITLE) as DepKind[]) {
      const list = p.deps.filter((x) => x.kind === kind)
      if (!list.length) continue
      body.append(el('div', 'npm-section', `${KIND_TITLE[kind]} (${list.length})`))
      for (const dep of list) body.append(depRow(p, dep))
    }
  }

  function depRow(p: NpmPackage, dep: NpmDep): HTMLElement {
    const row = el('div', 'npm-dep')
    row.dataset['dep'] = dep.name
    const info = latest[dep.name]
    row.append(el('span', 'npm-dep-name', dep.name), el('span', 'npm-dep-range', dep.range))
    const installed = el('span', `npm-dep-installed${dep.installed ? '' : ' missing'}`, dep.installed ?? 'not installed')
    row.append(installed)
    const newest = el('span', 'npm-dep-latest')
    if (info) {
      newest.textContent = `→ ${info.latest}`
      newest.title = `latest ${info.latest}; wanted by the range: ${info.wanted}`
      newest.classList.add('outdated')
    } else if (checked.has(p.dir)) newest.textContent = '✓'
    row.append(newest)
    const tools = el('span', 'npm-dep-tools')
    if (info) {
      const up = el('button', 'icon-btn small npm-update', '↑')
      up.title = `Update to ${info.latest}: ${commandFor(p.manager, 'update', dep.name, dep.kind)}`
      up.onclick = () => run(p.dir, commandFor(p.manager, 'update', dep.name, dep.kind), `${p.manager}: update ${dep.name}`)
      tools.append(up)
    }
    const rm = el('button', 'icon-btn small npm-remove', '✕')
    rm.title = `Remove ${dep.name}: ${commandFor(p.manager, 'remove', dep.name, dep.kind)}`
    rm.onclick = () => {
      if (confirm(`Remove ${dep.name} from ${p.name}?`)) run(p.dir, commandFor(p.manager, 'remove', dep.name, dep.kind), `${p.manager}: remove ${dep.name}`)
    }
    tools.append(rm)
    row.append(tools)
    return row
  }

  async function load(): Promise<void> {
    const root = d.getRoot()
    packages = root ? await window.forge.npmPackages(root) : []
    current = Math.min(current, Math.max(0, packages.length - 1))
    // The root package first, then the others in folder order.
    status.textContent = packages.length ? `${packages.length} package${packages.length === 1 ? '' : 's'}` : ''
    draw()
  }

  pick.onchange = () => {
    current = Number(pick.value)
    draw()
  }
  refresh.onclick = () => void load().catch((err: unknown) => d.report(`npm: ${err instanceof Error ? err.message : String(err)}`, true))
  install.onclick = () => {
    const p = pkg()
    if (p) run(p.dir, commandFor(p.manager, 'install'), `${p.manager}: install`)
  }
  edit.onclick = () => {
    const p = pkg()
    if (p) void d.openFile(`${p.dir}/package.json`).catch(() => undefined) // reported by the opener
  }
  outdated.onclick = () => {
    const p = pkg()
    if (!p) return
    outdated.disabled = true
    status.classList.remove('err')
    status.textContent = 'Checking the registry…'
    window.forge
      .npmOutdated(p.dir)
      .then((res) => {
        results.set(p.dir, res)
        checked.add(p.dir)
        const n = Object.keys(res).length
        status.textContent = n ? `${n} outdated` : 'Everything is up to date'
        draw()
      })
      .catch((err: unknown) => {
        const msg = (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
        status.textContent = msg
        status.classList.add('err')
      })
      .finally(() => (outdated.disabled = false))
  }

  draw()
  return { refresh: load }
}
