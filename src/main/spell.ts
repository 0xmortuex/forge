import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain } from 'electron'

// The spell checker's English dictionary (Hunspell format, from the dictionary-en package). The checker itself runs in the
// renderer; the main process only reads the two files, because the page cannot.

export interface SpellDictionary {
  aff: string
  dic: string
}

export function registerSpell(): void {
  ipcMain.handle('spell:dictionary', async (): Promise<SpellDictionary> => {
    // out/main/index.js -> ../../node_modules/dictionary-en
    const dir = join(__dirname, '../../node_modules/dictionary-en')
    const [aff, dic] = await Promise.all([readFile(join(dir, 'index.aff'), 'utf8'), readFile(join(dir, 'index.dic'), 'utf8')])
    return { aff, dic }
  })
}
