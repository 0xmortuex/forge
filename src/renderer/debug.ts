import * as monaco from 'monaco-editor'
import type { DebugEvent, DebugFrame, DebugVar } from '../main/debug'
import { icons } from './icons'
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

const keyOf = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function initDebug(deps: DebugDeps): {
  start: () => Promise<void>
  control: (cmd: Control) => Promise<void>
  toggleAtCursor: () => void
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
  // `saved` is the truth for files with no open model; for open files the editor decorations are
  // (they follow the text as lines move), so lines are always read back from them.
  const saved = new Map<string, { path: string; lines: number[] }>()
  const decos = new Map<monaco.editor.ITextModel, string[]>()

  function linesOf(path: string): number[] {
    const model = deps.getModel(path)
    const ids = model ? decos.get(model) : undefined
    if (model && ids) {
      return [...new Set(ids.map((id) => model.getDecorationRange(id)?.startLineNumber ?? 0).filter((l) => l > 0))].sort((a, b) => a - b)
    }
    return saved.get(keyOf(path))?.lines ?? []
  }

  function applyDecorations(model: monaco.editor.ITextModel, lines: number[]): void {
    decos.set(
      model,
      model.deltaDecorations(
        decos.get(model) ?? [],
        lines.map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            glyphMarginClassName: 'bp-glyph',
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        }))
      )
    )
  }

  function toggle(path: string, model: monaco.editor.ITextModel, line: number): void {
    const lines = linesOf(path)
    const next = lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line].sort((a, b) => a - b)
    saved.set(keyOf(path), { path, lines: next })
    applyDecorations(model, next)
    void deps.guard('Breakpoints', () => window.forge.debugSetBreakpoints(path, next)).catch(() => undefined) // reported
  }

  deps.editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return
    const path = deps.getActivePath()
    const model = path ? deps.getModel(path) : undefined
    if (path && model) toggle(path, model, e.target.position.lineNumber)
  })

  function toggleAtCursor(): void {
    const path = deps.getActivePath()
    const model = path ? deps.getModel(path) : undefined
    const line = deps.editor.getPosition()?.lineNumber
    if (path && model && line) toggle(path, model, line)
  }

  /** Sends every file's current breakpoint lines, including empty lists, before a launch. */
  async function syncBreakpoints(): Promise<void> {
    const paths = new Map<string, string>()
    for (const { path } of saved.values()) paths.set(keyOf(path), path)
    for (const path of paths.values()) await window.forge.debugSetBreakpoints(path, linesOf(path))
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
      await deps.saveAll()
      await syncBreakpoints()
      evalLog.replaceChildren()
      deps.showView('run')
      deps.setBusy(true)
      try {
        await deps.runView.begin((cols, rows) => window.forge.debugLaunch(resolved.cwd, cols, rows, resolved.spec))
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
    onModelOpened: (model, path) => {
      const lines = saved.get(keyOf(path))?.lines
      if (lines?.length) applyDecorations(model, lines)
    },
    onModelClosing: (model, path) => {
      saved.set(keyOf(path), { path, lines: linesOf(path) })
      decos.delete(model)
    }
  }
}
