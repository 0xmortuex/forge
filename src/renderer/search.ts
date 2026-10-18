/** Subsequence fuzzy match. Returns matched indices into `text` and a score (higher = better), or null. */
export function fuzzy(query: string, text: string): { score: number; idx: number[] } | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const idx: number[] = []
  let score = 0
  let from = 0
  for (const ch of q) {
    const at = t.indexOf(ch, from)
    if (at < 0) return null
    const prev = idx[idx.length - 1]
    if (prev !== undefined && at === prev + 1) score += 5
    if (at === 0 || '/\\._- '.includes(t[at - 1] ?? '')) score += 8
    score -= at - from
    idx.push(at)
    from = at + 1
  }
  return { score, idx }
}
