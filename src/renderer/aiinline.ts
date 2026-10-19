import * as monaco from 'monaco-editor'
import { aiConfig, aiConfigured, approveServer, ask, cleanCompletion, inlinePrompt } from './ai'
import { settings } from './settings'

// Inline suggestions ("ghost text"): after a short pause in typing, the code around the cursor is sent to the AI server and
// the answer is offered as grey text that Tab accepts. Off by default, because it sends a request on every pause.

export interface AiInlineDeps {
  report: (msg: string, isError?: boolean) => void
}

const PAUSE_MS = 400
const CHARS_BEFORE = 6000
const CHARS_AFTER = 2000
const MAX_COMPLETION_LINES = 25

export function initAiInline(d: AiInlineDeps): void {
  // Switching it on is the moment to agree to the server, not in the middle of typing.
  settings.onChange((key, value) => {
    if (key !== 'aiInline' || value !== true) return
    try {
      approveServer(aiConfig().baseUrl)
    } catch (err) {
      settings.set('aiInline', false)
      d.report(`AI suggestions stay off: ${err instanceof Error ? err.message : String(err)}`, true)
    }
  })

  let reportedFailure = false

  monaco.languages.registerInlineCompletionsProvider('*', {
    async provideInlineCompletions(model, position, _context, token) {
      const none = { items: [] }
      if (!settings.get<boolean>('aiInline') || !aiConfigured() || model.uri.scheme !== 'file') return none

      // Wait for a pause: a newer keystroke cancels this request before anything is sent.
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
      if (token.isCancellationRequested) return none

      const start = model.getFullModelRange().getStartPosition()
      const end = model.getFullModelRange().getEndPosition()
      const before = model.getValueInRange(new monaco.Range(start.lineNumber, start.column, position.lineNumber, position.column)).slice(-CHARS_BEFORE)
      const after = model.getValueInRange(new monaco.Range(position.lineNumber, position.column, end.lineNumber, end.column)).slice(0, CHARS_AFTER)
      if (!before.trim()) return none

      const inlineModel = settings.get<string>('aiInlineModel').trim() || undefined
      let raw: string
      try {
        raw = await ask(inlinePrompt(model.uri.path.split('/').pop() ?? 'file', model.getLanguageId(), before, after), {
          model: inlineModel,
          maxTokens: 128,
          temperature: 0,
          timeoutMs: 15000
        })
        reportedFailure = false
      } catch (err) {
        // One notice per run of failures: a broken setup must not produce a message on every pause.
        if (!reportedFailure) d.report(`AI suggestions: ${err instanceof Error ? err.message : String(err)}`, true)
        reportedFailure = true
        return none
      }
      if (token.isCancellationRequested) return none

      const text = cleanCompletion(raw).split('\n').slice(0, MAX_COMPLETION_LINES).join('\n')
      if (!text.trim()) return none
      return { items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] }
    },
    freeInlineCompletions: () => undefined
  })
}
