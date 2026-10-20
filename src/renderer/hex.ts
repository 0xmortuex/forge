// Hex dump rows for the hex viewer. Pure functions, no DOM.

export interface HexRow {
  /** Offset of the first byte, as 8 hex digits. */
  offset: string
  /** Two hex digits per byte (fewer than `width` on the last row). */
  bytes: string[]
  /** Printable ASCII, "." for everything else. */
  ascii: string
}

export const HEX_WIDTH = 16

export function hexRows(data: Uint8Array, baseOffset = 0, width = HEX_WIDTH): HexRow[] {
  const rows: HexRow[] = []
  for (let i = 0; i < data.length; i += width) {
    const chunk = data.subarray(i, i + width)
    rows.push({
      offset: (baseOffset + i).toString(16).padStart(8, '0'),
      bytes: [...chunk].map((b) => b.toString(16).padStart(2, '0')),
      ascii: [...chunk].map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    })
  }
  return rows
}

/** "1.5 KB" style size. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
