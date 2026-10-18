import * as monaco from 'monaco-editor'

// Syntax highlighting for Mort (.mx). Intelligence comes from Mort's own language server (`mortc lsp`).
// Keywords mirror mort/tokens.py; type names mirror the parser's FIXED_INT_TYPES / FLOAT_TYPES.

export const MORT = 'mort'

export function registerMort(): void {
  monaco.languages.register({ id: MORT, extensions: ['.mx'], aliases: ['Mort'] })
  monaco.languages.setLanguageConfiguration(MORT, {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] }
    ],
    surroundingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '"', close: '"' }]
  })
  monaco.languages.setMonarchTokensProvider(MORT, {
    keywords: [
      'let', 'fn', 'return', 'if', 'else', 'while', 'loop', 'for', 'in', 'as', 'struct', 'asm', 'extern', 'break',
      'continue', 'import', 'enum', 'match', 'const', 'test', 'module', 'pub', 'defer', 'try', 'type', 'resource', 'move'
    ],
    constants: ['true', 'false', 'null'],
    types: [
      'int', 'bool', 'void', 'i8', 'i16', 'i32', 'i64', 'u8', 'u16', 'u32', 'u64', 'f32', 'f64',
      'c_char', 'c_uchar', 'c_short', 'c_ushort', 'c_int', 'c_uint', 'c_long', 'c_ulong', 'c_size'
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"/, 'string', '@string'],
        [/'(?:[^'\\]|\\.)'/, 'string'],
        [/0[xX][0-9a-fA-F_]+/, 'number'],
        [/0[bB][01_]+/, 'number'],
        [/\d[\d_]*\.\d[\d_]*/, 'number'],
        [/\d[\d_]*/, 'number'],
        [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@constants': 'keyword', '@types': 'type', '@default': 'identifier' } }],
        [/[{}()[\]]/, 'delimiter'],
        [/[-+*/%=<>!&|^.:;,]+/, 'operator']
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment']
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop']
      ]
    }
  } as monaco.languages.IMonarchLanguage)
}
