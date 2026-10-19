import * as monaco from 'monaco-editor'

// Syntax highlighting for languages Monaco does not ship with. These are deliberately simple (comments, strings, numbers and
// keywords); the language servers (see main/langservers.ts) provide the real intelligence.

interface Simple {
  id: string
  extensions: string[]
  filenames?: string[]
  lineComment?: string
  blockComment?: [string, string]
  keywords: string[]
  /** Quote characters that start a string. */
  quotes?: string[]
}

const LANGS: Simple[] = [
  {
    id: 'zig',
    extensions: ['.zig'],
    lineComment: '//',
    keywords: 'const var fn pub return if else while for switch break continue defer errdefer try catch struct enum union error test comptime inline extern export usingnamespace orelse and or null undefined true false anytype void bool u8 u16 u32 u64 i8 i16 i32 i64 usize isize f32 f64'.split(' ')
  },
  { id: 'toml', extensions: ['.toml'], lineComment: '#', keywords: ['true', 'false'], quotes: ['"', "'"] },
  {
    id: 'haskell',
    extensions: ['.hs'],
    lineComment: '--',
    blockComment: ['{-', '-}'],
    keywords: 'module import qualified as hiding where let in if then else case of do data type newtype class instance deriving forall infixl infixr infix default foreign'.split(' ')
  },
  {
    id: 'ocaml',
    extensions: ['.ml', '.mli'],
    blockComment: ['(*', '*)'],
    keywords: 'let in rec and fun function match with if then else begin end type of module struct sig open include try raise exception mutable val external as when while for to do done'.split(' ')
  },
  {
    id: 'cmake',
    extensions: ['.cmake'],
    filenames: ['CMakeLists.txt'],
    lineComment: '#',
    keywords: 'if elseif else endif foreach endforeach while endwhile function endfunction macro endmacro set unset project add_executable add_library target_link_libraries target_include_directories find_package include option message install cmake_minimum_required'.split(' ')
  }
]

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

export function registerExtraLanguages(): void {
  for (const l of LANGS) {
    if (monaco.languages.getLanguages().some((x) => x.id === l.id)) continue // Monaco already knows it
    monaco.languages.register({ id: l.id, extensions: l.extensions, filenames: l.filenames })
    const quotes = l.quotes ?? ['"']
    const comments = [
      ...(l.lineComment ? [[new RegExp(`${escapeRe(l.lineComment)}.*$`), 'comment']] : []),
      ...(l.blockComment ? [[new RegExp(escapeRe(l.blockComment[0])), 'comment', '@block']] : [])
    ] as monaco.languages.IMonarchLanguageRule[]
    monaco.languages.setMonarchTokensProvider(l.id, {
      keywords: l.keywords,
      tokenizer: {
        root: [
          ...comments,
          [/[a-zA-Z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
          [/\d+(\.\d+)?([eE][+-]?\d+)?|0x[0-9a-fA-F]+/, 'number'],
          ...quotes.map((q): monaco.languages.IMonarchLanguageRule => [new RegExp(`${escapeRe(q)}([^${escapeRe(q)}\\\\]|\\\\.)*${escapeRe(q)}`), 'string'])
        ],
        block: l.blockComment
          ? [
              [new RegExp(escapeRe(l.blockComment[1])), 'comment', '@pop'],
              [/./, 'comment']
            ]
          : []
      }
    } as monaco.languages.IMonarchLanguage)
    monaco.languages.setLanguageConfiguration(l.id, {
      comments: { ...(l.lineComment ? { lineComment: l.lineComment } : {}), ...(l.blockComment ? { blockComment: l.blockComment } : {}) },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, ...quotes.map((q) => ({ open: q, close: q, notIn: ['string'] }))]
    })
  }
}
