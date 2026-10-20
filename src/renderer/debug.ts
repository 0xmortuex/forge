import * as monaco from 'monaco-editor'
import type { DebugEvent, DebugFrame, DebugVar } from '../main/debug'
import { icons } from './icons'
import { showMenu, askText, type MenuItem } from './menu'
import { session } from './session'
import type { ResolvedRun } from './run'
import type { TerminalView } from './terminal'

type Control = 'resume' | 'stepOver' | 'stepInto' | 'stepOut'

export interface DebugDeps {
  editor: monaco.editor.IStandaloneCodeEditor
  getModel: (path: string) => monaco.editor.ITextModel | undefined
  getActivePath: () => string | null
  openFile: (path: string, line?: number, column?: number) => Promise<void>
  report: (msg: string, isError?: boolean) => void
  guard: (label: string, fn: () => Promise<void>) => Promise<void>
  /** Resolves the selected run configuration for debugging (adds --inspect-brk). */
  resolveDebug: () => Promise<ResolvedRun>
  saveAll: () => Promise<void>
  runView: TerminalView
  showView: (view: 'run' | 'debug') => void
  stop: () => Promise<void>
  setBusy: (busy: boolean) => void
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

/** A breakpoint: its line, and optionally a condition, a log message, or being switched off. */
export interface Bp {
  line: number
  condition?: string
  logMessage?: string
  disabled?: boolean
}

const keyOf = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export interface BreakpointApi {
  all: () => (Bp & { path: string })[]
  setEnabled: (path: string, line: number, enabled: boolean) => void
  editCondition: (path: string, line: number) => Promise<void>
  editLog: (path: string, line: number) => Promise<void>
  remove: (path: string, line: number) => void
  removeAll: () => void
  onChange: (fn: () => void) => void
}

export function initDebug(deps: DebugDeps): {
  start: () => Promise<void>
  control: (cmd: Control) => Promise<void>
  toggleAtCursor: () => void
  breakpoints: BreakpointApi
  onModelOpened: (model: monaco.editor.ITextModel, path: string) => void
  onModelClosing: (model: monaco.editor.ITextModel, path: string) => void
} {
  const framesEl = byId('dbg-frames')
  const varsEl = byId('dbg-vars')
  const statusEl = byId('dbg-status')
  const evalInput = byId<HTMLInputElement>('dbg-input')
  const evalLog = byId('dbg-log')
  const bar = byId('dbg-bar')

  // ---- Breakpoints ----
  // A breakpoint can have a condition (pause only when true), a log message (print instead of pausing) or be disabled.
  // `saved` is the truth for files with no open model; for open files the editor decorations are (they follow the text
  // as lines move), so lines are always read back from them.
  const saved = new Map<string, { path: string; bps: Bp[] }>()
  const decos = new Map<monaco.editor.ITextModel, { id: string; bp: Omit<Bp, 'line'> }[]>()
  const listeners: (() => void)[] = []

  for (const b of session.get().breakpoints ?? []) {
    const entry = saved.get(keyOf(b.path)) ?? { path: b.path, bps: [] }
    entry.bps.push({ line: b.line, condition: b.condition, logMessage: b.logMessage, disabled: b.disabled })
    saved.set(keyOf(b.path), entry)
  }

  function bpsOf(path: string): Bp[] {
    const model = deps.getModel(path)
    const list = model ? decos.get(model) : undefined
    if (model && list) {
      const seen = new Set<number>()
      const out: Bp[] = []
      for (const d of list) {
        const line = model.getDecorationRange(d.id)?.startLineNumber ?? 0
        if (line > 0 && !seen.has(line)) {
          seen.add(line)
          out.push({ line, ...d.bp })
        }
      }
      return out.sort((x, y) => x.line - y.line)
    }
    return [...(saved.get(keyOf(path))?.bps ?? [])]
  }

  const kindOf = (bp: Omit<Bp, 'line'>): string => (bp.disabled ? 'bp-off' : bp.logMessage ? 'bp-log' : bp.condition ? 'bp-cond' : '')
  const describe = (bp: Omit<Bp, 'line'>): string =>
    [bp.disabled ? 'Disabled' : '', bp.condition ? `Condition: ${bp.condition}` : '', bp.logMessage ? `Logs: ${bp.logMessage}` : ''].filter(Boolean).join(' · ') || 'Breakpoint'

  function applyDecorations(model: monaco.editor.ITextModel, bps: Bp[]): void {
    const old = decos.get(model)?.map((d) => d.id) ?? []
    const ids = model.deltaDecorations(
      old,
      bps.map((bp) => ({
        range: new monaco.Range(bp.line, 1, bp.line, 1),
        options: {
          glyphMarginClassName: `bp-glyph ${kindOf(bp)}`.trim(),
          glyphMarginHoverMessage: { value: describe(bp) },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      }))
    )
    decos.set(model, ids.map((id, i) => ({ id, bp: { condition: bps[i]?.condition, logMessage: bps[i]?.logMessage, disabled: bps[i]?.disabled } })))
  }

  function persist(): void {
    const all: NonNullable<ReturnType<typeof session.get>['breakpoints']> = []
    const paths = new Map<string, string>()
    for (const { path } of saved.values()) paths.set(keyOf(path), path)
    for (const path of paths.values()) for (const bp of bpsOf(path)) all.push({ path, ...bp })
    session.update({ breakpoints: all })
    listeners.forEach((fn) => fn())
  }

  /** Makes `bps` the breakpoints of a file: remembers them, draws them, tells the debugger. */
  function commit(path: string, bps: Bp[]): void {
    const sorted = [...bps].sort((x, y) => x.line - y.line)
    saved.set(keyOf(path), { path, bps: sorted })
    const model = deps.getModel(path)
    if (model) applyDecorations(model, sorted)
    persist()
    void deps.guard('Breakpoints', () => window.forge.debugSetBreakpoints(path, sendable(sorted))).catch(() => undefined) // reported
  }
  const sendable = (bps: Bp[]): { line: number; condition?: string; logMessage?: string }[] =>
    bps.filter((b) => !b.disabled).map(({ line, condition, logMessage }) => ({ line, condition, logMessage }))

  function toggle(path: string, line: number): void {
    const bps = bpsOf(path)
    commit(path, bps.some((b) => b.line === line) ? bps.filter((b) => b.line !== line) : [...bps, { line }])
  }

  function update(path: string, line: number, change: Partial<Bp> | null): void {
    const bps = bpsOf(path)
    const found = bps.find((b) => b.line === line)
    if (change === null) return commit(path, bps.filter((b) => b.line !== line))
    commit(path, found ? bps.map((b) => (b.line === line ? { ...b, ...change } : b)) : [...bps, { line, ...change }])
  }

  async function editCondition(path: string, line: number): Promise<void> {
    const cur = bpsOf(path).find((b) => b.line === line)
    const value = await askText('Pause only when this expression is true (empty: always)', cur?.condition ?? '')
    if (value === null) return
    update(path, line, { condition: value.trim() || undefined, logMessage: undefined })
  }

  async function editLog(path: string, line: number): Promise<void> {
    const cur = bpsOf(path).find((b) => b.line === line)
    const value = await askText('Log this message instead of pausing — use {expression} for values', cur?.logMessage ?? '')
    if (value === null) return
    update(path, line, { logMessage: value.trim() || undefined, condition: undefined })
  }

  function bpMenu(path: string, line: number): (MenuItem | 'sep')[] {
    const cur = bpsOf(path).find((b) => b.line === line)
    if (!cur) {
      return [
        { label: 'Add Breakpoint', run: () => toggle(path, line) },
        { label: 'Add Conditional Breakpoint…', run: () => void editCondition(path, line) },
        { label: 'Add Logpoint…', run: () => void editLog(path, line) }
      ]
    }
    return [
      { label: cur.disabled ? 'Enable' : 'Disable', run: () => update(path, line, { disabled: cur.disabled ? undefined : true }) },
      { label: 'Edit Condition…', run: () => void editCondition(path, line) },
      { label: 'Edit Log Message…', run: () => void editLog(path, line) },
      'sep',
      { label: 'Remove Breakpoint', danger: true, run: () => update(path, line, null) }
    ]
  }

  deps.editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return
    if (e.event.rightButton) return // the context menu handles it
    const path = deps.getActivePath()
    if (path) toggle(path, e.target.position.lineNumber)
  })
  deps.editor.onContextMenu((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return
    const path = deps.getActivePath()
    if (!path) return
    e.event.preventDefault()
    showMenu(e.event.posx, e.event.posy, bpMenu(path, e.target.position.lineNumber))
  })

  function toggleAtCursor(): void {
    const path = deps.getActivePath()
    const line = deps.editor.getPosition()?.lineNumber
    if (path && line) toggle(path, line)
  }

  /** Sends every file's current breakpoints, including empty lists, before a launch. */
  async function syncBreakpoints(): Promise<void> {
    const paths = new Map<string, string>()
    for (const { path } of saved.values()) paths.set(keyOf(path), path)
    for (const path of paths.values()) await window.forge.debugSetBreakpoints(path, sendable(bpsOf(path)))
  }

  const allBreakpoints = (): (Bp & { path: string })[] => {
    const paths = new Map<string, string>()
    for (const { path } of saved.values()) paths.set(keyOf(path), path)
    return [...paths.values()].flatMap((path) => bpsOf(path).map((b) => ({ ...b, path }))).sort((x, y) => x.path.localeCompare(y.path) || x.line - y.line)
  }

  // ---- Watches: expressions evaluated again every time the program pauses ----
  const watchList = byId('dbg-watch-list')
  const watchInput = byId<HTMLInputElement>('dbg-watch-input')
  let watches = [...(session.get().watches ?? [])]

  async function renderWatches(): Promise<void> {
    watchList.replaceChildren()
    const frame = selected >= 0 ? frames[selected]?.id : undefined
    for (const expr of watches) {
      const row = document.createElement('div')
      row.className = 'watch'
      const name = document.createElement('span')
      name.className = 'vname'
      name.textContent = expr
      const val = document.createElement('span')
      val.className = 'vval undefined'
      val.textContent = frame === undefined ? '—' : '…'
      const remove = document.createElement('button')
      remove.className = 'icon-btn small'
      remove.title = 'Remove watch'
      remove.textContent = '✕'
      remove.onclick = () => {
        watches = watches.filter((w) => w !== expr)
        session.update({ watches })
        void renderWatches()
      }
      row.append(name, document.createTextNode(' = '), val, remove)
      watchList.append(row)
      if (frame !== undefined) {
        void window.forge.debugEvaluate(frame, expr).then(
          (r) => {
            val.className = `vval ${r.isError ? 'err' : r.type}`
            val.textContent = r.value
          },
          (err: unknown) => {
            val.className = 'vval err'
            val.textContent = err instanceof Error ? err.message : String(err)
          }
        )
      }
    }
  }
  watchInput.onkeydown = (e) => {
    if (e.key !== 'Enter' || !watchInput.value.trim()) return
    const expr = watchInput.value.trim()
    watchInput.value = ''
    if (!watches.includes(expr)) {
      watches.push(expr)
      session.update({ watches })
    }
    void renderWatches()
  }

  // ---- Paused state ----
  let frames: DebugFrame[] = []
  let selected = -1
  let exec: { model: monaco.editor.ITextModel; ids: string[] } | null = null

  const setButtons = (paused: boolean): void => {
    bar.querySelectorAll<HTMLButtonElement>('button[data-dbg]').forEach((b) => {
      b.disabled = b.dataset['dbg'] !== 'stop' && !paused
    })
  }
  const setStatus = (text: string): void => {
    statusEl.textContent = text
  }

  function clearExec(): void {
    if (exec) exec.model.deltaDecorations(exec.ids, [])
    exec = null
  }

  function clearPanes(): void {
    frames = []
    selected = -1
    framesEl.replaceChildren()
    varsEl.replaceChildren()
    setButtons(false)
    void renderWatches()
  }

  function varRow(
    v: { name: string; value: string; type: string; ref: number },
    depth: number,
    into: HTMLElement,
    autoExpand = false
  ): void {
    const row = document.createElement('div')
    row.className = 'var'
    row.style.paddingLeft = `${depth * 14 + 4}px`
    const twisty = document.createElement('span')
    twisty.className = 'twisty'
    if (v.ref) twisty.innerHTML = icons.chevronRight
    const name = document.createElement('span')
    name.className = 'vname'
    name.textContent = v.name
    const val = document.createElement('span')
    val.className = `vval ${v.type}`
    val.textContent = v.value
    row.append(twisty, name, document.createTextNode(v.value ? ':' : ''), val)
    into.append(row)
    if (!v.ref) return
    const kids = document.createElement('div')
    kids.hidden = true
    into.append(kids)
    let loaded = false
    const expand = async (): Promise<void> => {
      kids.hidden = !kids.hidden
      twisty.innerHTML = kids.hidden ? icons.chevronRight : icons.chevronDown
      if (loaded || kids.hidden) return
      loaded = true
      const children: DebugVar[] = await window.forge.debugVariables(v.ref)
      for (const c of children) varRow(c, depth + 1, kids)
    }
    row.onclick = () => void deps.guard('Variables', expand).catch(() => undefined) // reported
    if (autoExpand) void deps.guard('Variables', expand).catch(() => undefined) // reported
  }

  async function loadVariables(frame: number): Promise<void> {
    const scopes = await window.forge.debugScopes(frame)
    varsEl.replaceChildren()
    scopes.forEach((s, i) => varRow({ name: s.name, value: '', type: 'scope', ref: s.ref }, 0, varsEl, i === 0))
  }

  async function selectFrame(i: number, open: boolean): Promise<void> {
    const frame = frames[i]
    if (!frame) return
    selected = i
    framesEl.querySelectorAll('.frame').forEach((el, idx) => el.classList.toggle('sel', idx === i))
    clearExec()
    if (frame.path) {
      if (open) await deps.openFile(frame.path, frame.line, frame.column)
      const model = deps.getModel(frame.path)
      if (model) {
        exec = {
          model,
          ids: model.deltaDecorations([], [
            {
              range: new monaco.Range(frame.line, 1, frame.line, 1),
              options: { isWholeLine: true, className: 'debug-line', glyphMarginClassName: 'debug-glyph' }
            }
          ])
        }
      }
    }
    await loadVariables(frame.id)
    void renderWatches()
  }

  function renderFrames(): void {
    framesEl.replaceChildren()
    frames.forEach((f, i) => {
      const row = document.createElement('div')
      row.className = 'frame'
      const name = document.createElement('span')
      name.textContent = f.name
      const where = document.createElement('span')
      where.className = 'where'
      where.textContent = f.path ? `${basename(f.path)}:${f.line}` : '(internal)'
      row.append(name, where)
      row.onclick = () => void deps.guard('Stack frame', () => selectFrame(i, true)).catch(() => undefined) // reported
      framesEl.append(row)
    })
  }

  window.forge.onDebugEvent((evt: DebugEvent) => {
    if (evt.type === 'stopped') {
      // Hide node: internals (module loader etc.) unless that is all there is.
      const user = evt.frames.filter((f) => f.path)
      frames = user.length ? user : evt.frames
      renderFrames()
      setButtons(true)
      setStatus(`Paused (${evt.reason})`)
      deps.showView('debug')
      void deps.guard('Debugger', () => selectFrame(0, true)).catch(() => undefined) // reported
    } else if (evt.type === 'continued') {
      clearExec()
      clearPanes()
      setStatus('Running')
    } else if (evt.type === 'ended') {
      clearExec()
      clearPanes()
      setStatus('Finished')
      deps.setBusy(false)
    } else {
      deps.report(evt.message, true)
    }
  })

  // ---- Controls ----
  async function control(cmd: Control): Promise<void> {
    await deps.guard('Debugger', () => window.forge.debugControl(cmd))
  }

  bar.querySelectorAll<HTMLButtonElement>('button[data-dbg]').forEach((b) => {
    const cmd = b.dataset['dbg'] ?? ''
    b.innerHTML = { resume: icons.resume, stepOver: icons.stepOver, stepInto: icons.stepInto, stepOut: icons.stepOut, stop: icons.stop }[cmd] ?? ''
    b.onclick = () => {
      if (cmd === 'stop') void deps.stop()
      else void control(cmd as Control).catch(() => undefined) // reported by guard
    }
  })
  setButtons(false)
  setStatus('Not running')

  // ---- Evaluate ----
  evalInput.onkeydown = (e) => {
    if (e.key !== 'Enter' || !evalInput.value.trim()) return
    const expr = evalInput.value
    evalInput.value = ''
    const line = (text: string, cls = ''): void => {
      const div = document.createElement('div')
      div.className = cls
      div.textContent = text
      evalLog.append(div)
      evalLog.scrollTop = evalLog.scrollHeight
    }
    line(`> ${expr}`, 'echo')
    if (selected < 0) return line('Not paused — run to a breakpoint first', 'err')
    void window.forge.debugEvaluate(frames[selected]?.id ?? 0, expr).then(
      (r) => line(r.value, r.isError ? 'err' : r.type),
      (err: unknown) => {
        line(err instanceof Error ? err.message : String(err), 'err')
        deps.report(`Evaluate: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    )
  }

  // ---- Start ----
  async function start(): Promise<void> {
    await deps.guard('Debug', async () => {
      const resolved = await deps.resolveDebug()
      const kind = resolved.debugKind
      if (!kind) throw new Error(`${resolved.label} can't be debugged`)
      await deps.saveAll()
      await syncBreakpoints()
      evalLog.replaceChildren()
      deps.showView('run')
      deps.setBusy(true)
      try {
        await deps.runView.begin((cols, rows) => window.forge.debugLaunch(resolved.cwd, cols, rows, resolved.spec, kind, resolved.dap))
      } catch (err) {
        deps.setBusy(false)
        throw err
      }
      setStatus('Running')
      deps.report(`Debugging ${resolved.label}`)
    })
  }

  return {
    start,
    control,
    toggleAtCursor,
    breakpoints: {
      all: allBreakpoints,
      setEnabled: (path, line, enabled) => update(path, line, { disabled: enabled ? undefined : true }),
      editCondition,
      editLog,
      remove: (path, line) => update(path, line, null),
      removeAll: () => {
        for (const { path } of [...saved.values()]) commit(path, [])
      },
      onChange: (fn) => void listeners.push(fn)
    },
    onModelOpened: (model, path) => {
      const bps = saved.get(keyOf(path))?.bps
      if (bps?.length) applyDecorations(model, bps)
    },
    onModelClosing: (model, path) => {
      saved.set(keyOf(path), { path, bps: bpsOf(path) })
      decos.delete(model)
    }
  }
}
