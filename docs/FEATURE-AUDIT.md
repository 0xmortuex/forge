# Forge feature audit

An honest comparison of what Forge does today against JetBrains IDEs (IntelliJ and friends), Visual Studio and Visual
Studio Code. It was written after the "build everything" overnight run, from the code and the tests, not from memory.

**Legend**

- **Done**: works and has a test (end-to-end scenario or unit test).
- **Partial**: works, but narrower than the others (the note says how).
- **Missing**: not there, and could be built.
- **Not planned**: not realistic for a one-person Electron IDE, or it needs a backend Forge does not have. Each says why.

Counting is deliberately conservative. "Done" means the thing in the row, not that it matches the other IDE's polish.

## Editor

| Capability | Status | Notes |
| --- | --- | --- |
| Syntax highlighting, bracket matching, folding, minimap, sticky scroll, rulers | Done | Monaco. |
| Multi-cursor, column selection, find / replace with regex | Done | Monaco. |
| Live templates / snippets, surround with, Emmet, postfix completion | Done | Tab expands templates; postfix works for JS/TS, Python, Java, C#, Go, Rust, Kotlin and others. |
| Text transforms (case, sort lines, duplicate, join...) | Done | Command palette. |
| Split editor, side-by-side and inline diffs, editable diffs | Done | |
| Spell checking | Partial | English only; comments, strings, Markdown and text. |
| EditorConfig | Done | Indent, line endings, trailing whitespace, final newline. |
| File encodings | Done | 15 encodings, detected and preserved; reload / convert from the status bar. Search / replace and language-server file edits still assume UTF-8. |
| Line endings, indentation widgets | Done | Status bar. |
| Pinned tabs, tab reordering, reopen closed tab | Done | |
| Local history | Done | |
| Scratch files, bookmarks | Done | |
| Zen mode, Presentation mode, full screen | Done | |
| Code folding by region comments, custom folding | Missing | Monaco's defaults only. |
| Macros / recorded actions | Missing | |
| Rich text / WYSIWYG Markdown editing | Not planned | Markdown has a live preview window instead. |

## Navigation and search

| Capability | Status | Notes |
| --- | --- | --- |
| Search Everywhere, go to file / symbol / class / action | Done | |
| Recent files, recent locations, back / forward | Done | |
| Breadcrumbs, Structure window | Done | |
| Find usages, go to definition / implementation / type definition | Done | Through language servers. |
| Call hierarchy, type hierarchy | Done | |
| Go to test and back | Done | |
| Project-wide find / replace (regex, case, whole word, file mask) | Done | |
| TODO window | Done | |
| Structural search and replace | Missing | Would need an AST pattern matcher; not started. |
| Navigate by "related" files | Done | |

## Language intelligence

| Capability | Status | Notes |
| --- | --- | --- |
| Completion, hover, signature help, diagnostics, formatting, rename, quick fixes | Done | Language servers: TypeScript / JavaScript, Python, YAML, Shell and Dockerfile are bundled. |
| Many more languages | Partial | Go, Rust, C#, PHP, Ruby, Lua, Zig, Dart, Kotlin, Haskell, Terraform, TOML, XML, CMake, Swift, OCaml, SQL, C / C++ work when their server is installed; any server can be added in `settings.json`. Nothing is bundled for them and none were tested against the real servers (a fake server proves the plumbing). |
| Inlay hints, code lens ("N references") | Done | |
| Rename file updates imports | Done | |
| Safe Delete (warns about imports and links) | Done | Text matching of relative references; not semantic. |
| Extract method / variable, inline, move, change signature | Partial | Whatever the language server offers as a code action (*Refactor This…*). No refactorings of Forge's own. |
| Optimize imports | Partial | Where the server supports it. |
| Language-specific project models (Maven, Gradle, MSBuild solutions, .NET, JVM) | Not planned | These are what make Visual Studio and IntelliJ what they are for C# and Java. A different product. |
| Decompiler, bytecode viewer | Not planned | |

## Run, debug, test

| Capability | Status | Notes |
| --- | --- | --- |
| Run configurations (Node, Python, shell, current file) with an editor | Done | |
| Node debugger (V8 inspector), Python debugger (debugpy) | Done | Breakpoints with conditions, logpoints, watches, stepping, call stack, evaluate. |
| Debuggers for other languages (C / C++, Go, Java, C#...) | Partial | A generic Debug Adapter Protocol client: a run configuration of type `dap` names any adapter (lldb-dap, dlv, netcoredbg...), over stdio or TCP; breakpoints, stepping, variables, evaluate and program output work. Tested against a fake adapter that debugs a toy language, **not against any real adapter**, so adapter-specific launch arguments are yours to get right (`launch` in run.json). No attach picker, no exception breakpoints, no multi-thread view. |
| Test Explorer (node:test, Vitest, Jest, pytest), run arrows, run failed | Done | |
| Code coverage | Missing | |
| CPU / memory profiler | Missing | |
| Hot reload, edit-and-continue | Not planned | |
| Remote debugging, attach to process | Missing | |

## Version control

| Capability | Status | Notes |
| --- | --- | --- |
| Commit window, amend, **partial commits by hunk and by line** | Done | |
| Graph log, branches, merge / rebase / cherry-pick / revert / reset / tags | Done | |
| Interactive rebase (reorder, squash, fixup, reword, drop) | Done | |
| History for selection, file history, blame / annotate | Done | |
| Merge-conflict resolver | Done | Accept Yours / Theirs / Both for each block. |
| Gutter change markers with rollback, stash | Done | |
| Shelf / changelists | Partial | Stash covers shelving; there are no named changelists. |
| GitHub pull requests | Done | Through the `gh` CLI; tested against a fake `gh`. |
| GitLab / Bitbucket / Azure DevOps | Missing | |
| Other VCS (Mercurial, SVN, Perforce, TFS) | Not planned | |
| Code review inline comments on the diff | Missing | Comments go on the pull request as a whole. |

## Project tools and integrations

| Capability | Status | Notes |
| --- | --- | --- |
| npm window (scripts, dependencies, updates) | Done | npm, pnpm, yarn, bun. |
| Database viewer (SQLite, read-only) | Partial | SQL editor and result grid. Other databases (Postgres, MySQL, SQL Server...) and editing data are missing. |
| HTTP client for `.http` files | Done | |
| Docker window (containers, images, logs, shell, compose) | Done | Tested against a fake `docker`; Docker was not installed on the build machine. |
| Viewer: CSV / TSV table, notebooks, hex | Done | Notebooks are read-only: cells do not run. |
| Dependency / import diagram, UML | Missing | |
| Kubernetes, cloud explorers, Azure / AWS toolkits | Not planned | |
| Task runner integration (tasks.json, Gradle, Maven) | Missing | Run configurations cover single commands. |

## AI

| Capability | Status | Notes |
| --- | --- | --- |
| Chat, explain / fix / tests / document / refactor, inline suggestions, commit messages | Done | Any OpenAI-compatible server; your key, stored encrypted. |
| Agent mode that edits many files | Missing | |

## Shell and customization

| Capability | Status | Notes |
| --- | --- | --- |
| Docked tool windows, drag between edges, layout reset | Done | |
| Named layout presets | Done | Save the current arrangement under a name, apply it later; four built-in layouts. |
| Themes (17), accent, fonts, density, custom CSS | Done | |
| Keymap presets: Forge, IntelliJ, VS Code, Visual Studio | Done | Single-key combinations only; no chords (`Ctrl+K Ctrl+C`). |
| Settings export / import | Done | |
| Terminal: several shells, split side by side | Done | |
| Extensions API (panels, storage, events, permissioned network / AI / files) | Done | Small and documented. |
| Marketplace of extensions, VS Code extension compatibility | Not planned | VS Code extensions need its extension host and APIs. |
| Settings sync across machines, cloud account | Not planned | Export / import covers moving settings by hand. |
| Installer | Partial | Windows installer builds and the packaged app passes a smoke test, but the installer itself has not been run, is unsigned, and the Linux / macOS builds are untried. |

## Collaboration and remote

| Capability | Status | Notes |
| --- | --- | --- |
| Live Share, Code With Me | Not planned | Needs a relay service. |
| Remote development (SSH, containers, WSL, dev containers) | Not planned | Large; needs a remote agent. The terminal can open WSL or SSH shells, which is not the same. |
| Remote file systems / SFTP deployment | Missing | |

## Quality and accessibility

| Area | Status | Notes |
| --- | --- | --- |
| Inspect Code (tsc, ESLint, pyright) and duplicate detection | Done | Not as deep as IntelliJ's hundreds of inspections. |
| Automated tests | Done | 98 unit tests and 85 end-to-end scenarios; CI runs the unit tests and build on three OSes, and the scenarios on Windows (non-blocking). |
| Keyboard access to every command | Done | Everything is in the command palette. |
| Screen-reader support | Partial | Monaco's accessibility mode works. Forge's own windows are checked by a test (`a11y`): every visible control in every tool window, the welcome screen and every Settings page has a name, dialogs are announced, the status message is a live region and the status-bar widgets are keyboard buttons. Not checked: focus order, focus traps in dialogs, colour contrast of every theme, and nothing has been tried with an actual screen reader. |
| Right-to-left UI, localization | Missing | The interface is English only. |

## What I would build next

In order of value for the effort: trying the generic debug adapter client against a real adapter (lldb-dap, dlv), code coverage for Node and
Python, a dependency diagram, a real screen-reader and contrast pass, and database
connections beyond SQLite.
