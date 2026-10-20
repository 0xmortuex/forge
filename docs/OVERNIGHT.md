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
- **File encodings**: files are no longer assumed to be UTF-8. On open Forge detects BOMs (UTF-8, UTF-16 LE/BE), valid
  UTF-8, otherwise Windows-1252, and writes the file back the same way, so Latin-1 / UTF-16 files are not corrupted.
  Status bar → *Reload in Encoding…* (wrong guess) or *Save in Encoding…* (convert; 15 encodings incl. Turkish, Cyrillic,
  Central European, Shift_JIS, GBK, Big5, EUC-KR). Text an encoding cannot hold is refused, naming the character.
  (Not yet: files opened by language-server edits or search/replace still read and write UTF-8.)
- **Viewer window** (View → Toggle Viewer): the active file as a **table** (CSV / TSV / delimiter auto-detected,
  quoted cells, click a header to sort numerically or naturally, filter box, header-row switch), as a rendered
  **Jupyter notebook** (.ipynb: markdown, code, text / image / HTML outputs, tracebacks) or as a **hex dump** of the bytes
  on disk (any file, images included; 4 KB pages, previous / next, go to offset).
- **Pull Requests window** (GitHub, through the `gh` CLI and your own login; View → Toggle Pull Requests): open / closed /
  merged / all, with check status (running / passed / failed), draft and review badges; details with description, files
  changed (+/-), reviews and comments; **Checkout**, **View Diff** (opens in a tab), **Add Comment…**, **Open in Browser**
  and **New Pull Request…**. Says so plainly when gh is missing, not logged in or the folder isn't a GitHub repository.
  Tested against a fake `gh` (`tests/fake-gh.cjs`), not the real GitHub.
- **Docker window** (View → Toggle Docker): containers (running / paused / stopped) and images of the local Docker with
  Start / Stop / Restart / Pause / Resume / Remove, **Logs** (stdout + stderr in a tab), **Shell** (docker exec in a
  terminal tab), **Run** for images, and **Compose Up / Down** when the project has a compose file. Says when Docker is not
  installed or the daemon is not running. Tested against a fake docker (`tests/fake-docker.cjs`) only: Docker itself is not
  installed on the machine this was built on.
- **Split Terminal** (split button in the terminal tab bar, or the command): a second shell beside the first in the same tab,
  each with its own session. Typing `exit` in a split closes just that half; closing the tab closes both.
- **Installer**: `pnpm dist` builds a real Windows installer (`release/Forge Setup 0.1.0.exe`, 136 MB, NSIS, per-user,
  lets you pick the folder, Desktop + Start Menu shortcuts); AppImage and dmg are configured but untried.
  `pnpm test:packaged` starts the packaged app and checks the page, a real shell (node-pty), the spell dictionary and the
  YAML and TypeScript language servers from the packaged files. Doing that found a real bug: `typescript` was only a dev
  dependency, so the packaged TypeScript server could not start; it is now a runtime dependency. The installer is not
  code-signed (SmartScreen will warn) and I did not run the installer itself on this machine.
  `.github/workflows/release.yml` builds installers per OS as workflow artifacts (manual / on v* tags); untested in CI.
- **Safe Delete**: deleting a file or folder from the project tree first looks for what still points at it (JS/TS imports and
  re-exports, CSS imports and url(), C includes, HTML src/href, Markdown links, Python relative imports) and lists the
  lines. It asks even when "confirm before delete" is off. Text matching on relative references only: a reference built at
  run time, or a bare package import, is not seen.
- **Layout presets** (View → Save Layout As… / Apply Layout… / Delete Saved Layout…): remember where every tool window is, which
  one each dock shows and the panel sizes, under a name. Built in: Default, Editor Only, Wide Editor, Review.
- **Accessibility pass** over Forge's own interface, with a test that keeps it that way (`a11y`): the audit found unnamed
  drop-downs, status-bar widgets that a keyboard could not reach, dialogs that were not announced as dialogs, and no live
  region for status messages. All fixed. Not done: focus order, colour contrast per theme, a real screen reader.
