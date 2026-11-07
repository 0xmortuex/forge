import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// The spell checker's English dictionary (Hunspell format, from the dictionary-en package). The checker itself runs in the
// renderer; the backend only reads the two files, because the page cannot. Provided as the "spell" service (see platform).

export interface SpellDictionary {
  aff: string
  dic: string
}

export interface SpellApi {
  dictionary(): Promise<SpellDictionary>
}

export class SpellService implements SpellApi {
  async dictionary(): Promise<SpellDictionary> {
    // out/main/index.js -> ../../node_modules/dictionary-en
    const dir = join(__dirname, '../../node_modules/dictionary-en')
    const [aff, dic] = await Promise.all([readFile(join(dir, 'index.aff'), 'utf8'), readFile(join(dir, 'index.dic'), 'utf8')])
    return { aff, dic }
  }
}
