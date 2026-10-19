// Interactive rebase, planned in the open: the user's choices become the rebase's todo list. Nothing here talks to git or
// opens an editor. A reword is `pick` followed by `exec git commit --amend -F <file>`, and a squash is `fixup` followed by the
// same amend with the combined message, so everything lives in the todo list and survives a stop on conflicts.

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface RebaseStep {
  sha: string
  action: RebaseAction
  /** What the commit says now (subject and body). */
  original: string
  /**
   * The message to use. For `reword`: the new message (required). For a `pick` or `reword` that squashed commits follow:
   * the message of the combined commit (optional; by default the messages of the commit and its squashed commits, joined).
   */
  message?: string
}

export interface RebasePlan {
  /** The todo list, one command per line. */
  todo: string
  /** Message files to write before the rebase: `n` is the number used in the `exec` line, `text` its content. */
  messages: { n: number; text: string }[]
}

const SHA = /^[0-9a-f]{7,40}$/

/** Why this plan cannot be run, or null. */
export function planProblem(steps: RebaseStep[]): string | null {
  if (!steps.length) return 'There are no commits to rebase'
  for (const s of steps) if (!SHA.test(s.sha)) return `Not a commit id: ${s.sha}`
  const active = steps.filter((s) => s.action !== 'drop')
  if (!active.length) return 'Every commit is dropped: nothing would be left'
  const first = active[0] as RebaseStep
  if (first.action === 'squash' || first.action === 'fixup') return `The first commit that is kept cannot be "${first.action}": there is nothing before it to combine with`
  for (const s of active) if (s.action === 'reword' && !(s.message ?? '').trim()) return 'A reworded commit needs a new message'
  return null
}

const clean = (text: string): string => text.replace(/\r\n/g, '\n').trim()

/**
 * Builds the todo list and the message files. `steps` are oldest first. `squash` keeps the squashed commit's message in
 * the combined message, `fixup` throws it away.
 */
export function planTodo(steps: RebaseStep[]): RebasePlan {
  const problem = planProblem(steps)
  if (problem) throw new Error(problem)

  // Chains: a pick/reword and the squash/fixup steps that follow it (dropped steps in between do not break a chain).
  const active = steps.filter((s) => s.action !== 'drop')
  const chainOf = new Map<RebaseStep, RebaseStep[]>()
  let head: RebaseStep | null = null
  for (const s of active) {
    if (s.action === 'pick' || s.action === 'reword') {
      head = s
      chainOf.set(s, [s])
    } else {
      chainOf.get(head as RebaseStep)?.push(s)
    }
  }

  const messages: { n: number; text: string }[] = []
  const execAfter = new Map<RebaseStep, string>() // the last step of a chain -> the exec line that follows it
  for (const [h, members] of chainOf) {
    const squashed = members.slice(1).filter((m) => m.action === 'squash')
    let text: string | null = null
    if (h.action === 'reword') text = clean(h.message ?? '')
    else if (squashed.length) text = clean(h.message ?? '') || [h, ...squashed].map((m) => clean(m.original)).join('\n\n')
    if (text === null) continue
    const n = messages.length + 1
    messages.push({ n, text: text + '\n' })
    execAfter.set(members[members.length - 1] as RebaseStep, `MESSAGE:${n}`)
  }

  const lines: string[] = []
  for (const s of steps) {
    if (s.action === 'drop') lines.push(`drop ${s.sha}`)
    else if (s.action === 'pick' || s.action === 'reword') lines.push(`pick ${s.sha}`)
    else lines.push(`fixup ${s.sha}`)
    const exec = execAfter.get(s)
    if (exec) lines.push(exec) // the path is filled in by the caller, which knows where the files go
  }
  return { todo: lines.join('\n') + '\n', messages }
}

/** Replaces the `MESSAGE:n` placeholders of a todo list with real `exec` lines. `pathFor(n)` is the message file, with "/" separators. */
export function withExecLines(todo: string, pathFor: (n: number) => string): string {
  return todo.replace(/^MESSAGE:(\d+)$/gm, (_m, n: string) => `exec git commit --amend -q -F "${pathFor(Number(n))}"`)
}
