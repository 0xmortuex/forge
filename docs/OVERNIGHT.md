# What was added overnight (2026-10-19 → 2026-10-20)

A running log, newest at the bottom. Every item has an end-to-end scenario in `tests/scenarios` and was pushed once the
suite passed. "Not done" and "known gaps" are listed honestly at the end of this file.

## Git
- **Partial commits** (`d2a81d0`): in the Commit window choose hunks or single lines of a modified file; Forge commits
  exactly those through a temporary index, leaving your working file and anything you staged by hand untouched.
- **Interactive rebase**: *Interactively Rebase from Here…* in the Git window. Reorder, squash, fixup, reword and drop;
  warns about commits already pushed; survives a stop on conflicts (the plan lives in git's todo list).
- **History for selection**: `git log -L` for the selected lines, with only those lines' diffs.
- The Git window now refreshes when a commit is made elsewhere (terminal, other tools).

## Code quality
- **Find Duplicated Code**: copy-paste detection across the project; groups with every place, click to jump.

## Languages
- **Language breadth**: bundled YAML, Shell and Dockerfile servers; Go, Rust, C#, PHP, Ruby, Lua, Zig, Dart, Kotlin,
  Haskell, Terraform, TOML, XML, CMake, Swift, OCaml and SQL servers when installed (a missing one is mentioned once, calmly);
  your own servers through `languageServers` in `settings.json`; basic highlighting for Zig, TOML, Haskell, OCaml, CMake.
  See `docs/LANGUAGES.md`.

## Project tooling
- **npm window**: every package.json (monorepos too), its scripts (▶ runs them in a terminal tab), its dependencies with
  installed and latest versions, update / remove with the project's own package manager (pnpm, npm, yarn, bun).
- **Test Explorer**: runs node:test, Vitest, Jest and pytest; a tree of files, suites and tests with pass/fail, failure
  messages, jump to test, Run All / Run File / Run Failed.
- Terminals can now run a command in a new tab (used by the npm window).

## Quality
- **Unit tests** (`pnpm test:unit`, 45 tests, under a second): patches, rebase plans, duplicate detection, language-server
  validation and test-output parsers, run in CI on all three platforms. Writing them caught a real parser bug.

## Editing
- **Emmet** for HTML, XML, handlebars, razor, CSS, SCSS and Less: completion and Tab expansion.
- **Spell checker** (English): typos in comments, strings, Markdown and text files; Quick Fix corrects, adds to the
  dictionary or ignores. Words used as identifiers in the same file are never flagged in its comments.
- **Keymap presets**: Forge, IntelliJ, Visual Studio Code and Visual Studio (Settings → Keymap): line moves, duplicate,
  multi-cursor, go to file / symbol, run / debug keys of each editor.
- **Postfix completion** (`expr.if`, `.not`, `.log`, `.return`, `.for`, ... per language): type a dot after an expression.
- **Pinned tabs**: right-click a tab → Pin Tab. Pinned tabs move left, show a pin instead of a close button, survive
  Ctrl+W / Close All / Close Others and are remembered across restarts.
- **Presentation Mode** (command palette): Zen plus a 1.7x editor font and no minimap, for talks and screen sharing;
  toggling again restores your own settings.
- **Export / Import Settings…** (command palette): back up settings.json (including keymap and extension keys) to a file,
  or apply one. Import validates every value: invalid ones are skipped and named, unknown keys are kept.
