import { session } from './session'
import { settings } from './settings'

// The renderer's side of the AI features: reads the settings, asks the user before code goes to a new server, and talks to
// the main process (which holds the API key). Everything that builds prompts lives here too, so the chat, the selection
// actions, inline completions and commit messages are worded in one place.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

export interface ChatHandle {
  /** Resolves when the answer is complete (or was stopped); rejects with a readable message on failure. */
  done: Promise<void>
  cancel: () => void
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
const isLocal = (url: string): boolean => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(hostOf(url))

/** The configured server and model; throws a message that says what to set up when something is missing. */
export function aiConfig(model?: string): { baseUrl: string; model: string } {
  const baseUrl = settings.get<string>('aiBaseUrl').trim()
  const chosen = (model ?? settings.get<string>('aiModel')).trim()
  if (!baseUrl || !chosen) throw new Error('AI is not set up yet: open Settings → AI and enter a server URL, a model and (if the server needs one) an API key')
  return { baseUrl, model: chosen }
}

export const aiConfigured = (): boolean => settings.get<string>('aiBaseUrl').trim() !== '' && settings.get<string>('aiModel').trim() !== ''

/**
 * Code leaves the machine, so the user agrees once per server (a local server such as Ollama needs no agreement).
 * Throws when they decline.
 */
export function approveServer(baseUrl: string): void {
  if (isLocal(baseUrl)) return
  const host = hostOf(baseUrl)
  if (session.get().aiApprovedHost === host) return
  if (!confirm(`Forge will send your code (the file or selection you ask about) to ${host}.\n\nContinue?`)) {
    throw new Error(`Cancelled: nothing was sent to ${host}`)
  }
  session.update({ aiApprovedHost: host })
}

let nextId = 1

/** Streams an answer: `onDelta` gets the text as it arrives. */
export function chat(messages: ChatMessage[], onDelta: (text: string) => void, opts: AiOptions = {}): ChatHandle {
  const cfg = aiConfig(opts.model)
  approveServer(cfg.baseUrl)
  const id = nextId++
  let off: () => void = () => undefined
  let fail: (err: Error) => void = () => undefined
  const done = new Promise<void>((resolve, reject) => {
    fail = reject
    off = window.forge.onAiEvent((e) => {
      if (e.id !== id) return
      if (e.type === 'delta') onDelta(e.text)
      else {
        off()
        if (e.type === 'done') resolve()
        else reject(new Error(e.message))
      }
    })
  })
  window.forge.aiChat(id, { ...cfg, messages, maxTokens: opts.maxTokens, temperature: opts.temperature, timeoutMs: opts.timeoutMs }).catch((err: unknown) => {
    off()
    fail(err instanceof Error ? err : new Error(String(err)))
  })
  return { done, cancel: () => void window.forge.aiCancel(id) }
}

/** One complete answer. */
export async function ask(messages: ChatMessage[], opts: AiOptions = {}): Promise<string> {
  const cfg = aiConfig(opts.model)
  approveServer(cfg.baseUrl)
  return window.forge.aiComplete({ ...cfg, messages, maxTokens: opts.maxTokens, temperature: opts.temperature, timeoutMs: opts.timeoutMs })
}

// ---------------------------------------------------------------- prompts

export const SYSTEM_PROMPT =
  "You are the coding assistant built into Forge, an IDE. Answer concisely and accurately. Use Markdown, and put every piece of code in a fenced block with its language tag. When you change code, show the changed code, not a description of it. If you are unsure, say so instead of guessing."

export const MAX_CONTEXT_CHARS = 40000

/** Cuts text that is too long for a prompt, keeping the start and saying so. */
export function clip(text: string, max = MAX_CONTEXT_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters were left out)`
}

export interface EditorContext {
  path: string | null
  language: string | null
  /** The selected text ('' when nothing is selected). */
  selection: string
  /** The whole file ('' when no file is open). */
  fileText: string
}

/** The block of context that goes in front of a question. `mode` says which part of the editor to attach. */
export function contextBlock(ctx: EditorContext, mode: 'none' | 'selection' | 'file'): string {
  if (mode === 'none' || !ctx.path) return ''
  const lang = ctx.language ?? ''
  if (mode === 'selection' && ctx.selection) return `File: ${ctx.path}\nSelected code:\n\`\`\`${lang}\n${clip(ctx.selection)}\n\`\`\`\n\n`
  if (!ctx.fileText) return ''
  return `File: ${ctx.path}\n\`\`\`${lang}\n${clip(ctx.fileText)}\n\`\`\`\n\n`
}

export type Action = 'explain' | 'fix' | 'tests' | 'document' | 'refactor'

export const ACTIONS: Record<Action, { title: string; prompt: string }> = {
  explain: { title: 'Explain Code', prompt: 'Explain what this code does, step by step, and point out anything surprising.' },
  fix: { title: 'Find and Fix Problems', prompt: 'Find bugs or problems in this code and show the corrected code, explaining each fix briefly.' },
  tests: { title: 'Write Tests', prompt: 'Write unit tests for this code using the testing framework this project already uses (or the standard one for the language). Cover normal cases and edge cases.' },
  document: { title: 'Write Documentation', prompt: 'Write documentation comments for this code in the language\'s usual style. Show the code with the comments added.' },
  refactor: { title: 'Suggest Refactoring', prompt: 'Suggest how to make this code simpler and clearer, and show the refactored version.' }
}

/** What the model is told to do for an inline suggestion. */
export const INLINE_SYSTEM =
  'You are a code completion engine inside an editor. The text contains the marker <CURSOR>. Reply with ONLY the code that belongs at the marker: no explanation, no Markdown fences, and do not repeat code that is already before or after the marker. If nothing sensible belongs there, reply with nothing at all.'

export function inlinePrompt(path: string, language: string, before: string, after: string): ChatMessage[] {
  return [
    { role: 'system', content: INLINE_SYSTEM },
    { role: 'user', content: `File: ${path} (${language})\n\n${before}<CURSOR>${after}` }
  ]
}

/** Models sometimes wrap a completion in a fence or add a stray blank start; this undoes that. */
export function cleanCompletion(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n')
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(t.trim())
  if (fenced) t = fenced[1] as string
  return t.replace(/\s+$/, '')
}

export const COMMIT_SYSTEM =
  'You write git commit messages. Reply with only the message: a summary line of at most 72 characters in the imperative mood ("Add", "Fix"), then, only if the change needs it, a blank line and a short body. No quotes, no Markdown, no explanation.'

/** Strips the fences or quotes a model sometimes puts around a commit message. */
export function cleanCommitMessage(raw: string): string {
  let t = raw.trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(t)
  if (fenced) t = (fenced[1] as string).trim()
  if (!t.includes('\n') && /^(["'`]).*\1$/.test(t)) t = t.slice(1, -1)
  return t
}

export function commitPrompt(diff: string): ChatMessage[] {
  return [
    { role: 'system', content: COMMIT_SYSTEM },
    { role: 'user', content: `Write the commit message for this staged change:\n\n${clip(diff, 24000)}` }
  ]
}
