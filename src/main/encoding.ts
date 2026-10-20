import iconv from 'iconv-lite'
import { ENCODINGS } from './encodinglist'

export { ENCODINGS }

// Text file encodings. Forge edits everything as Unicode text; the encoding is only used to read the bytes in and to write
// them back, so opening and saving a Latin-1, Windows-1254 or UTF-16 file never corrupts it.

const KNOWN = new Set(ENCODINGS.map((e) => e.id))

export function assertEncoding(id: string): void {
  if (!KNOWN.has(id)) throw new Error(`Unsupported encoding: ${id}`)
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

/** Guesses how the bytes are encoded: a BOM decides, valid UTF-8 is UTF-8, anything else is Windows-1252 (never fails). */
export function detectEncoding(buf: Buffer): string {
  if (buf.length >= 3 && buf.subarray(0, 3).equals(UTF8_BOM)) return 'utf8bom'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le'
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf16be'
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return 'utf8'
  } catch {
    return 'windows-1252'
  }
}

export function decode(buf: Buffer, encoding: string): string {
  assertEncoding(encoding)
  if (encoding === 'utf8') return buf.toString('utf8')
  if (encoding === 'utf8bom') return (buf.subarray(0, 3).equals(UTF8_BOM) ? buf.subarray(3) : buf).toString('utf8')
  if (encoding === 'utf16le') return iconv.decode(buf, 'utf16le') // strips a BOM
  if (encoding === 'utf16be') return iconv.decode(buf, 'utf16be')
  return iconv.decode(buf, encoding)
}

/** Encodes text. Characters the encoding cannot represent raise an error instead of being replaced by "?". */
export function encode(text: string, encoding: string): Buffer {
  assertEncoding(encoding)
  if (encoding === 'utf8') return Buffer.from(text, 'utf8')
  if (encoding === 'utf8bom') return Buffer.concat([UTF8_BOM, Buffer.from(text, 'utf8')])
  if (encoding === 'utf16le' || encoding === 'utf16be') return iconv.encode(text, encoding, { addBOM: true })
  const out = iconv.encode(text, encoding)
  const back = iconv.decode(out, encoding)
  if (back !== text) {
    const at = [...text].findIndex((ch, i) => ch !== [...back][i])
    const ch = [...text][at] ?? '?'
    const label = ENCODINGS.find((e) => e.id === encoding)?.label ?? encoding
    throw new Error(`This text cannot be saved as ${label}: "${ch}" (U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}) has no equivalent. Convert the file to UTF-8 instead.`)
  }
  return out
}
