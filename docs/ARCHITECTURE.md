# Forge architecture

Forge is an Electron app, but its backend is organised the way a modern IDE platform is: a small **module registry**, a
typed **RPC** between the window and the backend, a **message bus** for events, and a **project index**. This page
explains the pieces, the one rule for deciding where code goes, how to add a service, and what is deliberately not done.

The design follows the notes in `intellij-notes` (the plugin/module system, the VFS and indexes, the frontend/backend
split, and the IDE as a tool server). It copies the *ideas*, not the JVM details.

## The pieces

```
window (renderer)                         backend (main process)
────────────────                          ───────────────────────────────────────────
rpc.ts: typed clients  ── rpc:call ─────▶ RpcServer ─▶ ModuleRegistry ─▶ service object
        event helpers  ◀─ rpc:event ───── Bus ◀─ services publish (term.data, fs.changed, ...)
```

| Piece | File | What it does |
|---|---|---|
| RPC protocol | `src/shared/rpc.ts` | `RpcServer.dispatch({service, method, args})` and a `client<T>()` proxy. Knows nothing about Electron: the transport is just a function. Only public methods are callable (not `_x`, `constructor`, or anything inherited from `Object`). |
| Module registry | `src/main/platform/modules.ts` | Modules have an id, `requires`, `provides` (service names) and `activation` (`startup` or `lazy`). Activation is dependency-ordered, shared between concurrent callers, retried after a failure; cycles and unlisted dependencies are errors. `unload` is vetoed while another active module still needs the module. Includes the topic **bus**. |
| Platform wiring | `src/main/platform/index.ts` | Registers every module, exposes `rpc:call` over IPC, forwards the bus to the window as `rpc:event`, and tells the services where their events go. |
| File index | `src/main/platform/fileindex.ts` | Every project file, persisted as a snapshot in user data (so the next start answers at once while a rescan reconciles), kept current from the file watcher, fuzzy name queries. |
| Text index | `src/main/platform/textindex.ts` | A trigram index of file text (and a count of the identifiers in it, for word completion), built in the background after each scan and updated by the watcher. A query keeps only files that contain all its trigrams and reads just those. Binary, over-512 KB and unreadable files are reported by `textStats`, not hidden. |
| Local line model | `src/main/platform/ngram.ts` | A token n-gram language model (contexts of 1 to 3 symbols, backoff to shorter ones) trained on the project's own files during the same index pass, one model per language family. It finishes the line being typed: it handles a half-typed word or string and a trailing space, and says nothing unless it is sure (first symbol at least 50% likely, every further one at least 35%, contexts seen at least twice). A file's contribution is stored so an edit or a delete takes back exactly what it taught. Caps: 200 KB per file, 5 million symbols. |
| WebSocket transport | `src/main/platform/ws.ts` | The same RPC and bus over a socket. A library: **nothing starts it** (see Security). |
| MCP server | `src/mcp/` | The project as tools for an external agent (see below). |

## Services

All are lazy modules, reached through `src/renderer/rpc.ts`.

| Service | Replaces | Notes |
|---|---|---|
| `fileindex` | (new) | `open`, `query`, `list`, `searchText`, `completeWord`, `suggestLine`, `modelStats`, `textStats`, `changed` |
| `remote` | (new) | `start`, `stop`, `status` for the WebSocket backend (see Remote transport) |
| `files` | `fs:*` handlers | read/write, encodings, bytes, listing, search/replace, create/rename/copy, realpath, references |
| `git` | `git:*` (44) | one method per old handler; moved by a parser, bodies unchanged |
| `settings`, `extensions` | `settings:*`, `state:save`, `extensions:*` | the files in the user-data folder |
| `terminal`, `watch`, `lsp`, `debug`, `ai` | streaming handlers | publish events, see below |
| `spell`, `history`, `scratch`, `npm`, `tests`, `http`, `inspect`, `duplicates`, `deps`, `docker`, `github`, `database` | one-shot handlers | request/response |

### Events on the bus

| Topic | Payload | From |
|---|---|---|
| `term.data` / `term.exit` | `{id, data}` / `{id, code}` | terminal (also the debugger's virtual terminals) |
| `fs.changed` / `fs.watchError` | `FsChange` / message | file watcher |
| `lsp.diagnostics` / `lsp.log` / `lsp.applyEdit` | `{uri, diagnostics}` / `{server, type, message}` / `{id, edit}` | language servers |
| `debug.event` | `DebugEvent` | debugger |
| `ai.event` | `{id, type: delta/done/error, ...}` | AI streaming |
| `fileindex.state` / `fileindex.error` | state / message | file index |

Services that start work without being called (the debugger starts terminals; the watcher runs on its own) publish through
an **emitter set at platform start-up** (`setTerminalEmitter` ...), not when their module activates. An unset emitter
throws; output is never silently dropped.

## The one rule: backend or host?

* **Backend**: anything about the project's files and programs. In a remote setup these must run where the files are.
  They are services.
* **Host**: anything that acts on *this computer's screen or account*: the folder picker and file dialogs, opening a
  folder in the file manager, the Recycle Bin, the clipboard, the browser, title bar and full screen, and the
  `forge-ext://` scheme. They stay as plain Electron handlers (`ipcMain.handle`) in `main/index.ts`, `settings.ts` and
  `extensions.ts`. There are 14 left, all of this kind.

## Adding a service

1. Write a class with public methods, no Electron types in its signatures (import `electron` only if it truly needs it).
   Export an `XxxApi` type (`export type XxxApi = XxxService` is enough).
2. Register it in `src/main/platform/index.ts`:
   `registry.register({ id: 'forge.xxx', activation: 'lazy', provides: ['xxx'], activate: () => ({ services: { xxx: new XxxService() } }) })`
3. Add a client in `src/renderer/rpc.ts`: `export const xxxService = client<XxxApi>('xxx', (req) => window.forge.rpc(req))`.
4. If it pushes events, give the module file a `setXxxEmitter`, call it in `registerPlatform`, and add a typed `onXxx`
   helper to `rpc.ts`. Never hold a `WebContents`.
5. Add checks to `tests/scenarios/platform-rpc.cjs`, and a unit test if the class does not import Electron (most don't, so
   they can run in plain Node: see `tests/unit/platform-*.test.ts` and `mcp.test.ts`).

## Remote transport

`startWsServer(rpc, bus)` / `connectWs(url, token)` carry the same requests and events over a WebSocket. Every service is
reachable through it, **the terminal included**, so it is strict by construction: loopback only, a random 256-bit token in
the `Authorization` header compared in constant time, any browser `Origin` refused, 8 MB message cap, a malformed message
closes the connection.

The only way to start it is the **Start Remote Backend…** command (Stop Remote Backend ends it; quitting Forge does too).
Starting shows a **native confirmation dialog from the main process** - the page cannot answer or skip it - that says what a
connection can do. On Start the token is copied to the clipboard and only the address is shown in the status line.

Known limits for a real remote setup:

* `files.readBytes` returns a `Uint8Array`: IPC carries it, JSON does not. It needs binary framing first.
* `ai`: the API key is encrypted with Electron `safeStorage` (the OS account of the machine running the window), so key
  storage would have to stay with the host.
* Nothing in the window talks to a remote backend yet; the transport is for other programs.
* `lsp.applyEdit` is a round trip to the window (it owns the editor models); with no window it waits for its 30 s timeout.

## The MCP server

`node out/main/mcp.js --root <project>` (built together with the app; it loads no Electron) speaks the Model Context
Protocol over stdio. Register it with an agent, for example Claude Code:

```
claude mcp add forge -- node "<forge folder>/out/main/mcp.js" --root "<project folder>"
```

Tools: `find_files`, `search_text`, `read_file`, `list_directory`, `git_status`, `git_log`. It is **read-only on purpose**
(a test asserts that no tool writes, deletes or runs anything), and every path is confined to the project root, including
links that point outside it. Only protocol messages go to stdout; diagnostics go to stderr.

## Testing

* `pnpm test:unit`: plain Node tests (164), no window. Covers the registry, RPC, file and text index (including races),
  the WebSocket transport over real sockets, and the MCP server (also as a real subprocess).
* `pnpm test`: builds, then runs every scenario in its own Electron window. `platform-rpc` exercises every service
  through the real RPC channel; the older scenarios drive the UI.
* CI (`.github/workflows/ci.yml`) runs typecheck, unit tests and build on three systems, and the scenarios on Windows.
  The scenario job is allowed to fail, and a few scenarios that depend on key timing flake on hosted runners:
  `git-rebase-interactive` and `chrome` were seen failing on the unchanged `main` branch, `navigation` and `keymap`
  failed once and passed when the same commit was re-run.

## What is not done

* The text index is in memory and rebuilt when a project opens; only the file list is persisted.
* Search Everywhere's **Text** scope (command *Find Text in Project*) and the MCP server use `searchText`; the older Find in Files
  window still has its own search with regex and case options.
* The notes' **Full Line** is a bundled neural model (about 68 MB, proprietary) run by a separate native process. Forge has the
  same shape, built from what can be built here: ghost text from a *local* model trained on-device (**Finish the line from your
  project**, Settings > Editor, off by default), word completion from the whole project (**Complete words from the whole
  project**, off by default), and model-based completion through any OpenAI-compatible server (`ai`). The local model is
  statistical, not neural, and it knows only the project it was trained on; it runs in the main process (a lookup takes
  microseconds, training is spread over the index build), not in a separate process.
