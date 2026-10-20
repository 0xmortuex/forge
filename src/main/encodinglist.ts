// The encodings Forge can read and write. Pure data, shared by the main process and the status bar.

export interface EncodingInfo {
  id: string
  label: string
}

export const ENCODINGS: EncodingInfo[] = [
  { id: 'utf8', label: 'UTF-8' },
  { id: 'utf8bom', label: 'UTF-8 with BOM' },
  { id: 'utf16le', label: 'UTF-16 LE (with BOM)' },
  { id: 'utf16be', label: 'UTF-16 BE (with BOM)' },
  { id: 'windows-1252', label: 'Windows-1252 (Western European)' },
  { id: 'iso-8859-1', label: 'ISO-8859-1 (Latin-1)' },
  { id: 'windows-1254', label: 'Windows-1254 (Turkish)' },
  { id: 'iso-8859-9', label: 'ISO-8859-9 (Turkish)' },
  { id: 'windows-1250', label: 'Windows-1250 (Central European)' },
  { id: 'iso-8859-2', label: 'ISO-8859-2 (Central European)' },
  { id: 'windows-1251', label: 'Windows-1251 (Cyrillic)' },
  { id: 'shift_jis', label: 'Shift_JIS (Japanese)' },
  { id: 'gbk', label: 'GBK (Simplified Chinese)' },
  { id: 'big5', label: 'Big5 (Traditional Chinese)' },
  { id: 'euc-kr', label: 'EUC-KR (Korean)' }
]

/** Short name for the status bar: "UTF-8", "Windows-1252"... */
export const shortName = (id: string): string => (ENCODINGS.find((e) => e.id === id)?.label ?? id).replace(/ \(.*\)$/, '').replace('UTF-8 with BOM', 'UTF-8 BOM')
