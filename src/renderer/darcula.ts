import * as monaco from 'monaco-editor'

export const DARCULA = 'darcula'

export function defineDarcula(): void {
  monaco.editor.defineTheme(DARCULA, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '808080', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'cc7832' },
      { token: 'string', foreground: '6a8759' },
      { token: 'number', foreground: '6897bb' },
      { token: 'type', foreground: 'a9b7c6' },
      { token: 'identifier', foreground: 'a9b7c6' },
      { token: 'delimiter', foreground: 'a9b7c6' }
    ],
    colors: {
      'editor.background': '#2b2b2b',
      'editor.foreground': '#a9b7c6',
      'editorLineNumber.foreground': '#606366',
      'editorLineNumber.activeForeground': '#a4a3a3',
      'editor.lineHighlightBackground': '#323232',
      'editor.selectionBackground': '#214283',
      'editorCursor.foreground': '#bbbbbb',
      'editorGutter.background': '#313335'
    }
  })
}
