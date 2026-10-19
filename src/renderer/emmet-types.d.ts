// The emmet package ships its own types, but they are not reachable through its package.json "exports" map under the bundler
// module resolution this project uses. This declares the small part Forge uses.
declare module 'emmet' {
  export interface ExtractedAbbreviation {
    abbreviation: string
    location: number
    start: number
    end: number
  }
  export function extract(line: string, pos?: number, options?: { lookAhead?: boolean; type?: 'markup' | 'stylesheet'; prefix?: string }): ExtractedAbbreviation | undefined
  export default function expandAbbreviation(abbr: string, config?: { type?: 'markup' | 'stylesheet'; syntax?: string; options?: Record<string, unknown> }): string
}
