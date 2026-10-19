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

## Editing
- **Emmet** for HTML, XML, handlebars, razor, CSS, SCSS and Less: completion and Tab expansion.
- **Spell checker** (English): typos in comments, strings, Markdown and text files; Quick Fix corrects, adds to the
  dictionary or ignores. Words used as identifiers in the same file are never flagged in its comments.
