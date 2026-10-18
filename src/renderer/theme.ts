import * as monaco from 'monaco-editor'

export const THEME = 'oceanic'

export function defineTheme(): void {
  monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '546e7a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c792ea' },
      { token: 'keyword.control', foreground: 'c792ea' },
      { token: 'string', foreground: 'c3e88d' },
      { token: 'number', foreground: 'f78c6c' },
      { token: 'regexp', foreground: '89ddff' },
      { token: 'type', foreground: 'ffcb6b' },
      { token: 'type.identifier', foreground: 'ffcb6b' },
      { token: 'identifier', foreground: 'eeffff' },
      { token: 'delimiter', foreground: '89ddff' },
      { token: 'operator', foreground: '89ddff' },
      { token: 'tag', foreground: 'f07178' },
      { token: 'attribute.name', foreground: 'ffcb6b' },
      { token: 'attribute.value', foreground: 'c3e88d' }
    ],
    colors: {
      'editor.background': '#263238',
      'editor.foreground': '#b0bec5',
      'editorLineNumber.foreground': '#465a64',
      'editorLineNumber.activeForeground': '#90a4ae',
      'editor.lineHighlightBackground': '#2c3b42',
      'editor.lineHighlightBorder': '#2c3b42',
      'editor.selectionBackground': '#2f5560',
      'editor.inactiveSelectionBackground': '#2b444c',
      'editor.findMatchBackground': '#26c6b055',
      'editorCursor.foreground': '#26c6b0',
      'editorIndentGuide.background1': '#314048',
      'editorIndentGuide.activeBackground1': '#4a606a',
      'editorGutter.background': '#263238',
      'editorWidget.background': '#2c3b42',
      'editorSuggestWidget.background': '#2c3b42',
      'editorSuggestWidget.selectedBackground': '#2f5560',
      'scrollbarSlider.background': '#5a737d44',
      'scrollbarSlider.hoverBackground': '#5a737d88'
    }
  })
}
