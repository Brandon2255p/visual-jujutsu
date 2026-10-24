# Changelog

## Unreleased

### Added
- **Operation log** view (history button): every jj operation with time and user; restore the repo to any of them (`jj op restore`).
- **Split** a revision: pick files from the revision menu, or split selected files from the file menu (`jj split`).
- **Absorb** a revision's changes into the mutable revisions that last touched those lines (`jj absorb`).
- **Discard changes** to files in a revision, back to the parent's version (`jj restore`).
- **Move up / Move down** to reorder a revision within its stack (⌥↑ / ⌥↓).
- **Rebase all my stacks on main** from the toolbar's More menu.
- Multi-select: **rebase** or **squash** several revisions at once.
- Bookmarks: **rename**, **delete**, **forget** and **track / untrack** remote bookmarks.
- **Push stack**: push every bookmark between trunk and a revision.
- **Push preview**: pushing from the toolbar or a stack first shows jj's dry-run report and asks to confirm.
- **Resolve conflicts** with your merge tool (`jj resolve` in a terminal); open conflicted files in the working copy.
- Command palette: Absorb, Split, Rebase All My Stacks on Main, Track / Untrack Remote Bookmarks.
- **Pull requests view** (PR button in the toolbar): your PRs grouped into stacks with checks and review state, a warning when a PR's base is out of date, and other open PRs.
- **Stacked PRs**: **Create PRs for stack** opens a PR for every revision between trunk and the one you pick, each based on the one below. **Sync stack** pushes every bookmark in a stack and fixes PR bases after a rebase, showing the plan first.
- **Post-merge cleanup**: when a PR with a local bookmark is merged, **Clean up** fetches, rebases the work on top of it onto trunk, abandons the merged revisions and deletes the bookmark.
- **Rebase preview** in the rebase dialog: the graph before and after, and which revisions would become conflicted. Nothing changes until you press Rebase.
- **Source Control view**: the working copy's changed files (conflicts listed first), gutter quick diffs against `@-`, and a message box that describes `@`.
- **Multi-root**: every jj repo in the workspace (including nested repos) gets its own graph and Source Control entry; switch with the repository picker or **Switch Repository**.
- PR badges show the review state in their tooltip.

### Fixed
- Repos opened through a symlinked path (for example `/var` on macOS) now match the files VS Code opens.

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
