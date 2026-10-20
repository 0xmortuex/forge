// What `docker ps / images --format "{{json .}}"` prints (one JSON object per line), reduced to what the Docker window shows.
// Pure, no I/O.

export type ContainerState = 'running' | 'paused' | 'exited' | 'created' | 'restarting' | 'dead' | 'other'

export interface Container {
  id: string
  name: string
  image: string
  /** Free text such as "Up 3 minutes" or "Exited (0) 2 hours ago". */
  status: string
  state: ContainerState
  ports: string
}

export interface DockerImage {
  id: string
  repository: string
  tag: string
  size: string
  created: string
}

type Json = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function lines(text: string): Json[] {
  const out: Json[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const v = JSON.parse(t) as unknown
      if (typeof v === 'object' && v !== null) out.push(v as Json)
    } catch {
      throw new Error(`Unexpected output from docker: ${t.slice(0, 80)}`)
    }
  }
  return out
}

export function stateOf(raw: string, status = ''): ContainerState {
  const s = raw.toLowerCase() || (/^up\b/i.test(status) ? (/\(paused\)/i.test(status) ? 'paused' : 'running') : /^exited/i.test(status) ? 'exited' : '')
  return (['running', 'paused', 'exited', 'created', 'restarting', 'dead'] as const).find((x) => x === s) ?? 'other'
}

export function parseContainers(text: string): Container[] {
  return lines(text).map((c) => ({
    id: str(c['ID']),
    name: str(c['Names']).split(',')[0] ?? '',
    image: str(c['Image']),
    status: str(c['Status']),
    state: stateOf(str(c['State']), str(c['Status'])),
    ports: str(c['Ports'])
  }))
}

export function parseImages(text: string): DockerImage[] {
  return lines(text).map((i) => ({
    id: str(i['ID']),
    repository: str(i['Repository']),
    tag: str(i['Tag']),
    size: str(i['Size']),
    created: str(i['CreatedSince'])
  }))
}

export type ContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove'

/** The actions that make sense for a container in this state. */
export function actionsFor(state: ContainerState): ContainerAction[] {
  switch (state) {
    case 'running':
    case 'restarting':
      return ['stop', 'restart', 'pause', 'remove']
    case 'paused':
      return ['unpause', 'stop', 'remove']
    default:
      return ['start', 'remove']
  }
}

/** The docker arguments for an action on one container. */
export function argsFor(action: ContainerAction, id: string): string[] {
  if (!/^[\w][\w.-]*$/.test(id)) throw new Error(`Not a container id or name: ${id}`)
  return action === 'remove' ? ['rm', '-f', id] : [action, id]
}

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']

/** The compose file among a folder's file names, if any (the one docker compose itself would pick first). */
export function composeFileOf(names: string[]): string | null {
  return COMPOSE_FILES.find((f) => names.includes(f)) ?? null
}
