# Writing a Forge extension

An extension is a folder with two files. Put it in Forge's extensions folder (**Settings → Extensions → Open
extensions folder**), reopen the Extensions page, and switch it on.

```
extensions/
  word-count/            <- the folder name is the extension's id: lowercase letters, digits, "-", "_" or "."
    extension.json
    index.js
```

A complete, working example lives in [`examples/extensions/word-count`](../examples/extensions/word-count).

## extension.json

```json
{
  "name": "Word Count",
  "version": "1.0.0",
  "description": "Shows the word count in the status bar.",
  "main": "index.js"
}
```

`name` defaults to the folder name, `main` to `index.js`. `main` must point to a file inside the folder.

## index.js

An ES module that exports `activate(forge)`. It may `import` other files from its own folder.

```js
export function activate(forge) {
  forge.commands.register({
    id: 'hello',
    title: 'Say Hello',
    run: () => forge.ui.toast('Hello from my extension!', 'ok')
  })
}
```

## The `forge` API (version 1)

| | |
| --- | --- |
| `forge.commands.register({ id, title, category?, keys?, run })` | Adds a command to the Command Palette. `category` defaults to the extension's name. `keys` is only the shortcut *shown* next to it; users can assign real shortcuts in Settings → Keymap. |
| `forge.ui.toast(message, kind?)` | A notification. `kind` is `'info'` (default), `'ok'`, `'warn'` or `'err'`. |
| `forge.ui.statusItem({ text, tooltip?, onClick? })` | An item in the status bar. Returns `{ update(text), dispose() }`. |
| `forge.editor.getText()` | Text of the active file, or `null` if no file is open. |
| `forge.editor.getSelectedText()` | The selection (`''` if none). |
| `forge.editor.replaceSelection(text)` / `insertText(text)` | Edit the active file (one undo step; the file is left unsaved). |
| `forge.editor.getFilePath()` / `getLanguage()` | Path and language id of the active file, or `null`. |
| `forge.workspace.root()` | The open project folder, or `null`. |
| `forge.settings.get(key)` | Read one of Forge's settings (read-only). |
| `forge.on('open' \| 'save', cb)` | Called with `{ path }` when a file is opened or saved. Returns a function that unsubscribes. |

Everything an extension registers (commands, status items, event listeners) is removed again when the user switches
it off.

## Trust and safety

Extensions run in Forge's own window with the same access as Forge itself: your files, terminals and git. That is
what makes them useful, and it means **only switch on extensions you trust**.

- Extensions are **off until you switch them on**. Forge never runs one it merely found.
- If `activate` throws, Forge reports the error (a notification and the Output window) and undoes whatever the
  extension had already registered. A broken extension cannot take the app down.
- Extension files are served through a `forge-ext://` protocol that only reaches inside the extension's own folder.
- Switching an extension off removes its commands, status items and listeners immediately. Code it has already run
  stays loaded until the window reloads (**Reload Window** in the Command Palette).
- Editing an extension's code takes effect after **Reload Window**, because the module is cached once loaded.

## Themes don't need an extension

To add a color theme, put a `.json` file in the **themes** folder (**Settings → Appearance → Open themes folder**):

```json
{ "name": "My Theme", "extends": "dracula", "colors": { "accent": "#ff0080" } }
```

`extends` names a built-in theme (`oceanic`, `darcula`, `dracula`, `nord`, `tokyo`, `monokai`, `solarized-dark`,
`gruvbox`, `catppuccin`, `rose-pine`, `one-dark`, `github-dark`, `synthwave`, `forge-light`, `solarized-light`,
`github-light`, `high-contrast`). Without `extends`, supply every color. Problems in a theme file are listed in
Settings → Appearance.
