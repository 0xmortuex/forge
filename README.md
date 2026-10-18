# Forge

A JetBrains-style IDE built with Electron, TypeScript and Monaco. It is a learning/portfolio project: the goal is a
fast, good-looking editor with real language intelligence, git, a terminal and a debugger, built phase by phase with
an end-to-end test suite that drives the real UI.

![Debugging a Node program in Forge](docs/debugger.png)

## Features

- **Look and feel** — floating "island" panels, a Material Oceanic palette, tool-window stripes, Search Everywhere
  (double-tap <kbd>Shift</kbd>).
- **Editor** — Monaco with tabs, a project tree (create / rename / delete via the context menu, delete goes to the
  Recycle Bin), and project-wide text search.
- **Language intelligence** — an LSP client: completion, hover, signature help, go-to-definition and live diagnostics.
  TypeScript/JavaScript (`typescript-language-server`) and Python (`pyright`) are bundled; C/C++ uses `clangd` if it is
  on your `PATH`.
- **Terminal** — a real PowerShell/shell session (node-pty + xterm.js).
- **Git** — branch widget, a Commit window with per-file checkboxes, side-by-side diffs, blame in the status bar and
  status colors in the tree. It drives the `git` CLI.
- **Run & debug** — run configurations in `.forge/run.json` (Node, Python, shell commands, or the current file), and a
  Node debugger with gutter breakpoints, stepping, call stack, variables and expression evaluation.

![Git diff and the Commit window](docs/git-diff.png)

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Open folder | <kbd>Ctrl</kbd>+<kbd>O</kbd> |
| Search Everywhere | <kbd>Shift</kbd> <kbd>Shift</kbd> |
| Find in project | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> |
| Project / Commit / Output / Terminal | <kbd>Alt</kbd>+<kbd>1</kbd> / <kbd>0</kbd> / <kbd>2</kbd> / <kbd>3</kbd> |
| Run / Debug / Stop | <kbd>Shift</kbd>+<kbd>F10</kbd> / <kbd>Shift</kbd>+<kbd>F9</kbd> / <kbd>Ctrl</kbd>+<kbd>F2</kbd> |
| Resume / Step over / Step into / Step out | <kbd>F9</kbd> / <kbd>F8</kbd> / <kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F8</kbd> |
| Toggle breakpoint | <kbd>Ctrl</kbd>+<kbd>F8</kbd> or click the gutter |

## Getting started

Requires Node 20+ and [pnpm](https://pnpm.io). Windows is the primary target (it is developed and tested there).

```sh
pnpm install
pnpm dev        # run in development
pnpm build      # production build into out/
pnpm test       # build, then run the end-to-end scenarios
```

A run configuration file looks like this (Forge creates a template via the run widget → *Edit Configurations…*):

```json
{
  "configurations": [
    { "name": "Current File", "type": "current-file" },
    { "name": "Run script", "type": "node", "program": "index.js", "args": [] },
    { "name": "Dev server", "type": "command", "command": "pnpm dev" }
  ]
}
```

## How it is built

- `src/main` — Electron main process: filesystem, node-pty terminals, language-server processes, git, and the Node
  debug adapter (V8 inspector protocol, exposed to the UI through DAP-shaped IPC).
- `src/preload` — the small, typed bridge exposed to the renderer.
- `src/renderer` — the UI (vanilla TypeScript, no framework).
- `tests/` — end-to-end scenarios. Each boots the built app against a temporary project, sends real key and mouse
  events, and asserts on the DOM and the filesystem (`pnpm test`).

## Known limitations

- Debugging is Node-only for now; Python can be run but not yet debugged.
- Diffs are read-only; there is no push/pull/stash/revert yet.
- No rename-symbol, find-usages, formatting or code actions yet.
- A single terminal; no extension system.

## License

MIT
