import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { ACTIONS, aiConfigured, chat, contextBlock, SYSTEM_PROMPT, type Action, type ChatHandle, type ChatMessage, type EditorContext } from './ai'
import { settings } from './settings'

// The AI Assistant window: a conversation about the code in the editor. Answers stream in as Markdown; code blocks get
// Copy / Insert / Replace buttons. Each question carries fresh context (the selection or the file), but only the questions
// and answers are kept as history, so a long conversation does not resend the same file over and over.

export interface AiChatDeps {
  /** The window's own root element. */
  root: HTMLElement
  context: () => EditorContext
  insertAtCursor: (text: string) => void
  replaceSelection: (text: string) => void
  copy: (text: string) => void
  /** Brings the window on screen. */
  reveal: () => void
  openSettings: () => void
  openExternal: (url: string) => void
  report: (msg: string, isError?: boolean) => void
}

export interface AiChatView {
  /** Asks a question (shown as typed); `attach` says what editor context goes with it. */
  send: (text: string, attach?: 'auto' | 'file' | 'none') => Promise<void>
  /** Runs one of the selection actions (Explain, Fix, …). */
  runAction: (action: Action) => Promise<void>
  newChat: () => void
  focus: () => void
}

const MAX_HISTORY = 20

export function initAiChat(d: AiChatDeps): AiChatView {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  // ---- layout ----
  const bar = el('div', 'tool-bar')
  const model = el('span', 'ai-model')
  model.id = 'ai-model'
  const fresh = el('button', 'btn', 'New Chat')
  fresh.id = 'ai-new'
  bar.append(model, fresh)

  const thread = el('div', 'ai-thread')
  thread.id = 'ai-thread'

  const composer = el('div', 'ai-composer')
  const attach = el('select', 'field ai-attach')
  attach.setAttribute('aria-label', 'What to send with the question')
  attach.id = 'ai-attach'
  attach.title = 'What to send along with your question'
  for (const [v, label] of [['auto', 'Selection or file'], ['file', 'Whole file'], ['none', 'No context']] as const) {
    const o = el('option', '', label)
    o.value = v
    attach.append(o)
  }
  const input = el('textarea', 'field ai-input')
  input.id = 'ai-input'
  input.rows = 3
  input.placeholder = 'Ask about the code…  (Enter to send, Shift+Enter for a new line)'
  input.spellcheck = false
  const send = el('button', 'btn-primary', 'Send')
  send.id = 'ai-send'
  const stop = el('button', 'btn', 'Stop')
  stop.id = 'ai-stop'
  stop.hidden = true
  const row = el('div', 'ai-actions')
  row.append(attach, send, stop)
  composer.append(input, row)
  d.root.replaceChildren(bar, thread, composer)

  // ---- state ----
  let history: ChatMessage[] = []
  let current: ChatHandle | null = null

  const paintModel = (): void => {
    const m = settings.get<string>('aiModel').trim()
    model.textContent = aiConfigured() ? m : 'not set up'
  }
  paintModel()
  settings.onChange((key) => {
    if (key === 'aiModel' || key === 'aiBaseUrl') paintModel()
  })

  function emptyState(): void {
    thread.replaceChildren()
    const box = el('div', 'ai-empty')
    if (!aiConfigured()) {
      box.append(el('div', 'hint', 'The assistant is not set up yet. Choose a server, a model and (if needed) an API key.'))
      const b = el('button', 'btn-primary', 'Open AI Settings')
      b.id = 'ai-setup'
      b.onclick = () => d.openSettings()
      box.append(b)
    } else {
      box.append(el('div', 'hint', 'Ask about the open file or your selection. Select code and use Explain, Find and Fix, Write Tests… from the right-click menu.'))
    }
    thread.append(box)
  }
  emptyState()

  const nearBottom = (): boolean => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40

  /** Markdown -> sanitized HTML, with buttons on every code block. */
  function renderMarkdown(into: HTMLElement, text: string): void {
    into.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true, async: false }) as string)
    into.querySelectorAll('a').forEach((a) => {
      a.onclick = (ev) => {
        ev.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (/^https?:\/\//.test(href)) d.openExternal(href)
      }
    })
    into.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
      const tools = el('div', 'ai-code-tools')
      const mk = (label: string, cls: string, run: () => void): void => {
        const b = el('button', `btn small ${cls}`, label)
        b.onclick = run
        tools.append(b)
      }
      mk('Copy', 'ai-copy', () => d.copy(code))
      mk('Insert', 'ai-insert', () => d.insertAtCursor(code))
      mk('Replace selection', 'ai-replace', () => d.replaceSelection(code))
      pre.prepend(tools)
    })
  }

  function addMessage(role: 'user' | 'assistant' | 'error', text: string): HTMLElement {
    if (thread.querySelector('.ai-empty')) thread.replaceChildren()
    const m = el('div', `ai-msg ${role}`)
    const who = el('div', 'ai-who', role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : 'Problem')
    const body = el('div', role === 'assistant' ? 'ai-body md-body' : 'ai-body')
    if (role === 'assistant') renderMarkdown(body, text)
    else body.textContent = text
    m.append(who, body)
    const stick = nearBottom()
    thread.append(m)
    if (stick) thread.scrollTop = thread.scrollHeight
    return body
  }

  function setBusy(busy: boolean): void {
    send.hidden = busy
    stop.hidden = !busy
    input.disabled = busy
    if (!busy) input.focus()
  }

  async function ask(text: string, mode: 'auto' | 'file' | 'none', shown = text): Promise<void> {
    if (current) return
    if (!aiConfigured()) {
      d.openSettings()
      throw new Error('AI is not set up yet: enter a server URL and a model in Settings → AI')
    }
    d.reveal()
    const ctx = d.context()
    const block = contextBlock(ctx, mode === 'auto' ? (ctx.selection ? 'selection' : 'file') : mode)
    addMessage('user', shown + (block ? (ctx.selection && mode === 'auto' ? '\n(with your selection)' : '\n(with the open file)') : ''))
    const answer = addMessage('assistant', '')
    answer.classList.add('streaming')
    let acc = ''
    let queued = false
    const flush = (): void => {
      queued = false
      const stick = nearBottom()
      renderMarkdown(answer, acc)
      if (stick) thread.scrollTop = thread.scrollHeight
    }
    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.slice(-MAX_HISTORY), { role: 'user', content: block + text }]
    setBusy(true)
    try {
      current = chat(messages, (delta) => {
        acc += delta
        if (!queued) {
          queued = true
          requestAnimationFrame(flush)
        }
      })
      await current.done
      flush()
      history.push({ role: 'user', content: text }, { role: 'assistant', content: acc })
      history = history.slice(-MAX_HISTORY)
    } catch (err) {
      answer.closest('.ai-msg')?.remove()
      addMessage('error', err instanceof Error ? err.message : String(err))
    } finally {
      answer.classList.remove('streaming')
      current = null
      setBusy(false)
    }
  }

  function submit(): void {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    ask(text, attach.value as 'auto' | 'file' | 'none').catch((err: unknown) => d.report(err instanceof Error ? err.message : String(err), true))
  }
  send.onclick = submit
  stop.onclick = () => current?.cancel()
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  fresh.onclick = () => view.newChat()

  const view: AiChatView = {
    send: (text, mode = 'auto') => ask(text, mode),
    async runAction(action) {
      const ctx = d.context()
      if (!ctx.path) throw new Error('Open a file first')
      const a = ACTIONS[action]
      d.reveal()
      return ask(a.prompt, ctx.selection ? 'auto' : 'file', `${a.title}${ctx.selection ? '' : ' (whole file)'}`)
    },
    newChat() {
      current?.cancel()
      history = []
      emptyState()
    },
    focus: () => input.focus()
  }
  return view
}
