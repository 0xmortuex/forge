import type { WebContents } from 'electron'

// Types shared by the debug backends (Node via the V8 inspector, Python via debugpy's DAP) and the UI.

export interface DebugFrame {
  id: number // opaque, backend-defined: pass it back to scopes() / evaluate()
  name: string
  path: string | null // null for node: internals and other non-file scripts
  line: number // 1-based
  column: number // 1-based
}

export interface DebugScope {
  name: string
  ref: number
}

export interface DebugVar {
  name: string
  value: string
  type: string // normalized to the names the UI colors: string, number, boolean, undefined, ...
  ref: number // > 0 when the value has children to expand
}

export interface DebugEval {
  value: string
  type: string
  ref: number
  isError: boolean
}

export type DebugEvent =
  | { type: 'stopped'; reason: string; frames: DebugFrame[] }
  | { type: 'continued' }
  | { type: 'ended' }
  | { type: 'error'; message: string }

export type Control = 'resume' | 'stepOver' | 'stepInto' | 'stepOut' | 'pause'
export type DebugKind = 'node' | 'python'

export interface SessionDeps {
  wc: WebContents
  /** Breakpoints the user has set (path -> 1-based lines); kept even with no session. */
  desired: Map<string, Breakpoint[]>
  /** Tells the orchestrator this session is over. */
  onEnded: () => void
}

export interface DebugSession {
  ptyId: number
  readonly connected: boolean
  /** Sees the program's terminal output (Node prints its inspector URL there). */
  onOutput(data: string): void
  onProcessExit(): void
  applyBreakpoints(path: string, bps: Breakpoint[]): Promise<void>
  control(cmd: Control): Promise<unknown>
  scopes(frameId: number): Promise<DebugScope[]>
  variables(ref: number): Promise<DebugVar[]>
  evaluate(frameId: number, expression: string): Promise<DebugEval>
}

/** A breakpoint the user set. Only enabled ones reach the debugger. */
export interface Breakpoint {
  /** 1-based line. */
  line: number
  /** Pauses only when this expression is true. */
  condition?: string
  /** A logpoint: prints this (with {expressions} filled in) instead of pausing. */
  logMessage?: string
}
