# Changelog

## 0.1.1 (pre-release)

### Fixed
- The graph failed to load on jj older than 0.46 ("Failed to parse template: Syntax error"). Visual Jujutsu now works with jj 0.27 and later.
- Rebase uses `-d` instead of `-o` on jj before 0.36.
- Pushing a new bookmark works on jj before 0.42 (passes `--allow-new`).
- Changed-file line counts work on jj before 0.36.
- A clear message when jj is older than 0.27, and when Redo is used on jj before 0.33.

## 0.1.0 (pre-release)

First release.

### Added
- Revision graph in the sidebar: lanes, working copy, immutable/conflicted/empty revisions, bookmarks (local, remote, conflicted), tags, PR and CI badges.
- Revset presets (Default, Mine, Stack of @, All, Bookmarks), saved revsets, and a revset filter box.
- Auto-refresh when jj records an operation, on file save, and on window focus.
- Expand a revision to see changed files with line counts; click a file to open a diff.
- Describe inline, new revision (on top, insert after, insert before, merge), edit, abandon, squash into parent or any revision.
- Move files between revisions by drag and drop or the file context menu.
- Rebase by drag and drop (⌥ only this revision, ⇧ whole branch, drop on a row edge to insert before/after), from the context menu, or with the rebase dialog. One-click rebase on main.
- Bookmarks: create, move by dragging the chip (asks before moving backwards), push.
- Fetch, push bookmarks, push a revision as a new bookmark; "Fetch and retry" when a push is rejected.
- GitHub pull requests via `gh`: create (bases stacked PRs on the PR below), move a PR to another revision, open on GitHub.
- Undo and redo, command log output channel, status bar item.
- Planned features are already in the UI and show "not supported yet". See FEATURES.md.
