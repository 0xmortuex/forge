import { actionsFor, type Container, type ContainerAction, type DockerImage } from '../main/dockerparse'
import type { DockerStatus } from '../main/docker'

// The Docker window: containers and images of the local Docker, start / stop / restart / pause / remove, logs in a tab,
// a shell inside a running container (in a terminal tab), and docker compose up / down for the project's compose file.

export interface DockerDeps {
  root: HTMLElement
  getRoot: () => string | null
  /** Runs a command line in a new terminal tab started in `cwd`. */
  runCommand: (cwd: string, command: string, title: string) => void
  /** Opens text in a new tab (a container's log). */
  openText: (ext: string, text: string) => Promise<void>
  report: (msg: string, isError?: boolean) => void
}

export interface DockerView {
  refresh: () => Promise<void>
}

type Tab = 'containers' | 'images'

const ACTION_LABEL: Record<ContainerAction, string> = { start: 'Start', stop: 'Stop', restart: 'Restart', pause: 'Pause', unpause: 'Resume', remove: 'Remove' }
const SAFE = /^[\w][\w.:/@-]*$/

export function initDocker(d: DockerDeps): DockerView {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  const bar = el('div', 'tool-bar dk-bar')
  const title = el('span', 'tool-title', 'Docker')
  const version = el('span', 'dk-version')
  version.id = 'dk-version'
  const tabs = el('span', 'viewer-modes')
  const tabButtons = new Map<Tab, HTMLButtonElement>()
  for (const [id, label] of [['containers', 'Containers'], ['images', 'Images']] as const) {
    const b = el('button', 'viewer-mode', label)
    b.id = `dk-tab-${id}`
    b.onclick = () => {
      tab = id
      void refresh()
    }
    tabButtons.set(id, b)
    tabs.append(b)
  }
  const spacer = el('span', 'dk-spacer')
  const up = el('button', 'btn', 'Compose Up')
  up.id = 'dk-up'
  const down = el('button', 'btn', 'Compose Down')
  down.id = 'dk-down'
  up.hidden = down.hidden = true
  const refreshBtn = el('button', 'btn', 'Refresh')
  refreshBtn.id = 'dk-refresh'
  bar.append(title, version, tabs, spacer, up, down, refreshBtn)
  const body = el('div', 'dk-body')
  body.id = 'dk-body'
  d.root.replaceChildren(bar, body)

  let tab: Tab = 'containers'
  let seq = 0

  const hint = (text: string, error = false): void => body.replaceChildren(el('div', error ? 'hint err' : 'hint', text))

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      d.report(`${label}: ${err instanceof Error ? err.message : String(err)}`, true)
    }
  }

  function containerRow(root: string, c: Container): HTMLElement {
    const r = el('div', `dk-row dk-${c.state}`)
    r.dataset['name'] = c.name
    r.append(el('span', `dk-dot ${c.state}`), el('span', 'dk-name', c.name), el('span', 'dk-image', c.image), el('span', 'dk-status', c.status), el('span', 'dk-ports', c.ports))
    const buttons = el('span', 'dk-buttons')
    const add = (label: string, onClick: () => void, danger = false): void => {
      const b = el('button', `btn small${danger ? ' danger' : ''}`, label)
      b.dataset['do'] = label.toLowerCase()
      b.onclick = onClick
      buttons.append(b)
    }
    for (const action of actionsFor(c.state)) {
      add(ACTION_LABEL[action], () => {
        if (action === 'remove' && !confirm(`Remove container ${c.name}? Its data that is not in a volume is lost.`)) return
        void run(ACTION_LABEL[action], async () => {
          await window.forge.dockerAction(root, action, c.name)
          d.report(`${ACTION_LABEL[action]}: ${c.name}`)
          await refresh()
        })
      }, action === 'remove')
    }
    add('Logs', () => void run('Logs', async () => d.openText('log', await window.forge.dockerLogs(root, c.name))))
    if (c.state === 'running') add('Shell', () => d.runCommand(root, `docker exec -it ${c.name} sh`, `docker: ${c.name}`))
    r.append(buttons)
    return r
  }

  function imageRow(root: string, i: DockerImage): HTMLElement {
    const ref = i.repository && i.repository !== '<none>' ? `${i.repository}:${i.tag}` : i.id
    const r = el('div', 'dk-row')
    r.dataset['name'] = ref
    r.append(el('span', 'dk-name', ref), el('span', 'dk-image', i.size), el('span', 'dk-status', i.created), el('span', 'dk-ports', i.id))
    const buttons = el('span', 'dk-buttons')
    const run1 = el('button', 'btn small', 'Run')
    run1.dataset['do'] = 'run'
    run1.onclick = () => {
      if (!SAFE.test(ref)) return d.report(`Cannot run an image called ${ref}`, true)
      d.runCommand(root, `docker run -it --rm ${ref}`, `docker run ${ref}`)
    }
    const rm = el('button', 'btn small danger', 'Remove')
    rm.dataset['do'] = 'remove'
    rm.onclick = () => {
      if (!confirm(`Remove image ${ref}?`)) return
      void run('Remove image', async () => {
        await window.forge.dockerRemoveImage(root, ref)
        d.report(`Removed image ${ref}`)
        await refresh()
      })
    }
    buttons.append(run1, rm)
    r.append(buttons)
    return r
  }

  async function refresh(): Promise<void> {
    const mine = ++seq
    for (const [id, b] of tabButtons) b.classList.toggle('active', id === tab)
    const root = d.getRoot()
    if (!root) {
      version.textContent = ''
      return hint('Open a project to use Docker from here.')
    }
    const status: DockerStatus = await window.forge.dockerStatus(root)
    if (mine !== seq) return
    version.textContent = status.running ? `Docker ${status.version}` : ''
    up.hidden = down.hidden = !(status.running && status.composeFile)
    up.title = down.title = status.composeFile ? `docker compose, using ${status.composeFile}` : ''
    if (!status.running) return hint(status.message, true)
    try {
      if (tab === 'containers') {
        const list = await window.forge.dockerContainers(root)
        if (mine !== seq) return
        if (!list.length) return hint('No containers. Start one from the Images tab, or with Compose Up.')
        body.replaceChildren(...list.map((c) => containerRow(root, c)))
      } else {
        const list = await window.forge.dockerImages(root)
        if (mine !== seq) return
        if (!list.length) return hint('No images.')
        body.replaceChildren(...list.map((i) => imageRow(root, i)))
      }
    } catch (err) {
      if (mine === seq) hint(err instanceof Error ? err.message : String(err), true)
    }
  }

  refreshBtn.onclick = () => void refresh()
  up.onclick = () => {
    const root = d.getRoot()
    if (root) d.runCommand(root, 'docker compose up -d', 'compose up')
  }
  down.onclick = () => {
    const root = d.getRoot()
    if (root) d.runCommand(root, 'docker compose down', 'compose down')
  }

  return { refresh }
}
