import type { ConfigType, RunConfig } from './run'

// The Run Configurations dialog: a list of configurations on the left, a form for the selected one on the right.
// Saving writes .forge/run.json (the file stays the source of truth; "Open run.json" is there for hand-editing).

export interface RunConfigsDeps {
  configs: RunConfig[]
  /** Called with the edited list. Throws (with a message to show) if it can't be saved. */
  onSave: (configs: RunConfig[]) => Promise<void>
  openJson: () => void
}

const TYPE_LABEL: Record<ConfigType, string> = {
  'current-file': 'Current file',
  node: 'Node.js script',
  python: 'Python script',
  command: 'Shell command',
  dap: 'Debug adapter (any language)'
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

/** "--flag value 'two words'" -> ["--flag", "value", "two words"] (a small shell-style split). */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

export const joinArgs = (args: string[] | undefined): string => (args ?? []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')

export function openRunConfigs(deps: RunConfigsDeps): void {
  const overlay = byId('runcfg')
  const listEl = byId('runcfg-list')
  const formEl = byId('runcfg-form')
  const errEl = byId('runcfg-error')
  const copyOf = (c: RunConfig): RunConfig => ({
    ...c,
    args: c.args ? [...c.args] : undefined,
    env: c.env ? { ...c.env } : undefined,
    adapter: c.adapter ? { ...c.adapter, args: c.adapter.args ? [...c.adapter.args] : undefined } : undefined
  })
  const list: RunConfig[] = deps.configs.map(copyOf)
  let selected = 0

  const field = (label: string, input: HTMLElement, hint = ''): HTMLElement => {
    const row = document.createElement('label')
    row.className = 'rc-field'
    const l = document.createElement('span')
    l.className = 'rc-label'
    l.textContent = label
    row.append(l, input)
    if (hint) {
      const h = document.createElement('span')
      h.className = 'rc-hint'
      h.textContent = hint
      row.append(h)
    }
    return row
  }
  const text = (value: string, onInput: (v: string) => void, placeholder = ''): HTMLInputElement => {
    const i = document.createElement('input')
    i.className = 'field'
    i.value = value
    i.placeholder = placeholder
    i.spellcheck = false
    i.oninput = () => onInput(i.value)
    return i
  }

  function drawList(): void {
    listEl.replaceChildren()
    list.forEach((c, i) => {
      const row = document.createElement('div')
      row.className = 'rc-item' + (i === selected ? ' sel' : '')
      row.dataset['index'] = String(i)
      const name = document.createElement('span')
      name.className = 'rc-name'
      name.textContent = c.name || '(unnamed)'
      const kind = document.createElement('span')
      kind.className = 'rc-kind'
      kind.textContent = TYPE_LABEL[c.type]
      row.append(name, kind)
      row.onclick = () => {
        selected = i
        draw()
      }
      listEl.append(row)
    })
  }

  function drawForm(): void {
    formEl.replaceChildren()
    const c = list[selected]
    if (!c) {
      const h = document.createElement('div')
      h.className = 'hint'
      h.textContent = 'No configurations. Add one with the + button.'
      formEl.append(h)
      return
    }
    formEl.append(field('Name', text(c.name, (v) => ((c.name = v), drawList()))))
    const type = document.createElement('select')
    type.setAttribute('aria-label', 'Configuration type')
    type.className = 'field'
    type.id = 'rc-type'
    for (const t of Object.keys(TYPE_LABEL) as ConfigType[]) {
      const o = document.createElement('option')
      o.value = t
      o.textContent = TYPE_LABEL[t]
      type.append(o)
    }
    type.value = c.type
    type.onchange = () => {
      c.type = type.value as ConfigType
      draw()
    }
    formEl.append(field('Type', type))
    if (c.type === 'node' || c.type === 'python') {
      formEl.append(field('Script', text(c.program ?? '', (v) => (c.program = v), c.type === 'node' ? 'index.js' : 'main.py'), 'Relative to the project folder.'))
      formEl.append(field('Arguments', text(joinArgs(c.args), (v) => (c.args = splitArgs(v))), 'Separated by spaces; quote an argument that contains spaces.'))
    } else if (c.type === 'dap') {
      const adapter = (c.adapter ??= { command: '' })
      formEl.append(field('Adapter command', text(adapter.command, (v) => (adapter.command = v), 'lldb-dap'), 'The debug adapter program, on your PATH or a full path (lldb-dap, dlv, netcoredbg...).'))
      formEl.append(field('Adapter arguments', text(joinArgs(adapter.args), (v) => (adapter.args = splitArgs(v))), 'For a TCP adapter put ${port} where it wants its port.'))
      const transport = document.createElement('select')
      transport.setAttribute('aria-label', 'Adapter transport')
      transport.className = 'field'
      for (const [value, label] of [['stdio', 'Standard input / output'], ['tcp', 'TCP port']] as const) {
        const o = document.createElement('option')
        o.value = value
        o.textContent = label
        transport.append(o)
      }
      transport.value = adapter.transport ?? 'stdio'
      transport.onchange = () => (adapter.transport = transport.value as 'stdio' | 'tcp')
      formEl.append(field('Talks over', transport))
      const request = document.createElement('select')
      request.setAttribute('aria-label', 'Request')
      request.className = 'field'
      for (const [value, label] of [['launch', 'Launch the program'], ['attach', 'Attach to a running one']] as const) {
        const o = document.createElement('option')
        o.value = value
        o.textContent = label
        request.append(o)
      }
      request.value = c.request ?? 'launch'
      request.onchange = () => (c.request = request.value as 'launch' | 'attach')
      formEl.append(field('Request', request))
      formEl.append(field('Program', text(c.program ?? '', (v) => (c.program = v || undefined), 'build/app'), 'Relative to the project folder.'))
      formEl.append(field('Arguments', text(joinArgs(c.args), (v) => (c.args = splitArgs(v))), 'Separated by spaces; quote an argument that contains spaces.'))
      const note = document.createElement('div')
      note.className = 'rc-hint'
      note.textContent = 'Anything else the adapter wants (stopOnEntry, mode, port, processId...) goes under "launch" in run.json (Open run.json).'
      formEl.append(note)
    } else if (c.type === 'command') {
      formEl.append(field('Command', text(c.command ?? '', (v) => (c.command = v), 'pnpm dev'), 'Run by the system shell.'))
    } else {
      const note = document.createElement('div')
      note.className = 'rc-hint'
      note.textContent = 'Runs the file that is open in the editor (JavaScript, TypeScript or Python).'
      formEl.append(note)
    }
    formEl.append(field('Working directory', text(c.cwd ?? '', (v) => (c.cwd = v || undefined), 'project folder'), 'Relative to the project folder.'))
    const env = document.createElement('textarea')
    env.className = 'field rc-env'
    env.spellcheck = false
    env.placeholder = 'KEY=value, one per line'
    env.value = Object.entries(c.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')
    env.oninput = () => {
      const out: Record<string, string> = {}
      for (const line of env.value.split('\n')) {
        const m = /^\s*([^=\s]+)\s*=(.*)$/.exec(line)
        if (m) out[m[1]!] = m[2]!
      }
      c.env = Object.keys(out).length ? out : undefined
    }
    formEl.append(field('Environment variables', env))
  }

  function draw(): void {
    drawList()
    drawForm()
  }

  function close(): void {
    overlay.hidden = true
    errEl.textContent = ''
  }

  byId('runcfg-add').onclick = () => {
    list.push({ name: `Configuration ${list.length + 1}`, type: 'node', program: '' })
    selected = list.length - 1
    draw()
  }
  byId('runcfg-dup').onclick = () => {
    const c = list[selected]
    if (!c) return
    list.splice(selected + 1, 0, { ...copyOf(c), name: `${c.name} copy` })
    selected++
    draw()
  }
  byId('runcfg-del').onclick = () => {
    if (!list.length) return
    list.splice(selected, 1)
    selected = Math.max(0, Math.min(selected, list.length - 1))
    draw()
  }
  byId('runcfg-json').onclick = () => {
    close()
    deps.openJson()
  }
  byId('runcfg-cancel').onclick = close
  byId('runcfg-save').onclick = () => {
    errEl.textContent = ''
    deps.onSave(list).then(close, (err: unknown) => {
      errEl.textContent = err instanceof Error ? err.message : String(err) // shown here, where the user is looking
    })
  }
  overlay.onmousedown = (e) => {
    if (e.target === overlay) close()
  }
  overlay.hidden = false
  draw()
}
