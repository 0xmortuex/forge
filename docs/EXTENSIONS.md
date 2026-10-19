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

`name` defaults to the folder name, `main` to `index.js`. `main` must point to a file inside the folder. An optional
`"permissions"` list (`"network"`, `"ai"`, `"files"`) asks for parts of the API that are off by default; see
[Permissions](#permissions).

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

## The `forge` API (version 2)

`forge.version` is `2`. Version 2 only *adds* to version 1, so extensions written for version 1 keep working unchanged.

| | |
| --- | --- |
| `forge.commands.register({ id, title, category?, keys?, run })` | Adds a command to the Command Palette. `category` defaults to the extension's name. `keys` is only the shortcut *shown* next to it; users can assign real shortcuts in Settings → Keymap. |
| `forge.ui.toast(message, kind?)` | A notification. `kind` is `'info'` (default), `'ok'`, `'warn'` or `'err'`. |
| `forge.ui.statusItem({ text, tooltip?, onClick? })` | An item in the status bar. Returns `{ update(text), dispose() }`. |
| `forge.ui.panel({ id, title, icon?, dock?, render(root) })` | **New.** Adds a tool window with its own stripe button. `dock` is `'left'`, `'right'` (default) or `'bottom'`; `icon` is SVG markup (sanitized). `render(root)` is called once with the panel's element: build your UI in it, and optionally return a clean-up function. Returns `{ show(), dispose() }`. Users can still drag it to another dock. |
| `forge.ui.input({ title, value? })` | **New.** Asks the user for a line of text. Resolves to the text, or `null` if they cancel. |
| `forge.editor.getText()` | Text of the active file, or `null` if no file is open. |
| `forge.editor.getSelectedText()` | The selection (`''` if none). |
| `forge.editor.replaceSelection(text)` / `insertText(text)` | Edit the active file (one undo step; the file is left unsaved). |
| `forge.editor.getFilePath()` / `getLanguage()` | Path and language id of the active file, or `null`. |
| `forge.workspace.root()` | The open project folder, or `null`. |
| `forge.workspace.readFile(path)` | **New, needs `"files"`.** Reads a text file inside the project (a path relative to the project, or absolute). A path that leaves the project folder is refused. |
| `forge.workspace.listFiles()` | **New, needs `"files"`.** The project's files, as paths relative to the project using `/`. |
| `forge.settings.get(key)` | Read one of Forge's settings (read-only). |
| `forge.storage.get(key, fallback?)` / `set(key, value)` / `delete(key)` | **New.** Data the extension keeps between sessions, private to it (one JSON file, up to 1 MB). Values must be JSON-serializable. Writes are saved a moment after the last change, and immediately when the extension is switched off. |
| `forge.net.fetch(url, { method?, headers?, body? })` | **New, needs `"network"`.** An HTTP(S) request made by Forge, so the browser's cross-origin rules do not apply. Resolves to `{ status, ok, statusText, headers, text, json() }`. |
| `forge.ai.complete(prompt, { maxTokens? }?)` | **New, needs `"ai"`.** Asks the AI server the user set up (Settings → AI) and resolves to the answer text. `prompt` is a string or a list of `{ role, content }`. If AI is not set up it rejects with a message saying so; the user is asked to approve the server the first time, exactly as for the built-in features ([AI features](AI.md)). |
| `forge.on(event, cb)` | Called with `{ path }`. Events: `'open'` (a file was opened), `'save'`, `'activate'` (the file in the editor changed), `'close'` (a tab was closed) and `'change'` (the text was edited; sent about 300 ms after typing stops). Returns a function that unsubscribes. |

Everything an extension registers (commands, status items, panels, event listeners) is removed again when the user
switches it off.

### Permissions

Three abilities have to be asked for in `extension.json`:

```json
{
  "name": "My Extension",
  "permissions": ["network", "ai", "files"]
}
```

| Permission | Unlocks | Shown to the user as |
| --- | --- | --- |
| `network` | `forge.net.fetch` | "make web requests" |
| `ai` | `forge.ai.complete` | "send text to your AI server" |
| `files` | `forge.workspace.readFile`, `listFiles` | "read files in your project" |

Settings → Extensions lists what each extension asks for next to its switch, so the user sees it before turning it on.
Calling one of these without having asked fails with an error that names the permission to add. An unknown permission name
makes the extension invalid (the page says which names exist).

**These permissions are a declaration and a guard on Forge's API, not a sandbox.** An extension runs inside Forge's own
window with the same power as Forge itself (see below), so a malicious one could bypass the API. Treat the list as
honest disclosure from authors you trust, and only switch on extensions you trust.

### A panel that remembers things

```js
export function activate(forge) {
  forge.ui.panel({
    id: 'notes',
    title: 'Notes',
    render(root) {
      const box = document.createElement('textarea')
      box.value = forge.storage.get('text', '')
      box.oninput = () => forge.storage.set('text', box.value)
      root.append(box)
    }
  })
}
```

Two complete examples live in [`examples/extensions`](../examples/extensions): **notes-panel** (a panel with a note per
file, using storage and the `activate` event) and **ai-summary** (asks for `"ai"` and summarizes the open file).

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
