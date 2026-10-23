# Visual Jujutsu — Feature Set (draft for approval)

A VS Code extension that shows the `jj` revision graph and lets you change it directly, without remembering revsets or flags.
Every action maps to a real `jj` / `gh` command. The extension never edits `.jj` state itself, so `jj undo` always works.

Target: jj ≥ 0.46, colocated git repos, GitHub via the `gh` CLI.

Priority key: **P0** = MVP, **P1** = first release after MVP, **P2** = later.

**Every feature in this document ships in the UI from the first release**: buttons, context-menu entries, drag targets and commands all exist from day one.
Priority only decides when the feature works. Until then, using it shows an info message: *"<Feature> is not supported yet."*
This lets the whole design be built and reviewed at once, and features are switched on as they land.

---

## 1. Revision graph (the core view)

| # | Feature | Pri | Backed by |
|---|---|---|---|
| 1.1 | Graph panel in the sidebar: nodes, edges, merges, elided ancestors (`~`) | P0 | `jj log -T <json template>` |
| 1.2 | Each row: change ID (short, highlighted prefix), description, author, relative time, bookmarks, tags, remote bookmarks | P0 | template |
| 1.3 | Node styles: working copy `@`, immutable (◆), empty, conflicted, divergent, hidden | P0 | template fields |
| 1.4 | "You are here" marker on `@` | P0 | |
| 1.5 | Revset filter box with presets: Default, Mine, All, Stack of `@`, Bookmarks only, plus saved custom revsets | P0 | `jj log -r` |
| 1.6 | Auto-refresh when the repo changes (file watcher on `.jj/repo/op_heads`) plus a manual refresh button | P0 | |
| 1.7 | Expand a row to see changed files with +/− counts; click a file to open a diff in VS Code's diff editor | P0 | `jj diff --stat`, `jj file show -r` |
| 1.8 | Multi-select revisions (shift/cmd-click) for bulk actions | P1 | |
| 1.9 | PR badge on bookmarks: PR number, state (open/draft/merged), CI status, review state | P1 | `gh pr list --json` |
| 1.10 | Compact / comfortable density toggle | P2 | |

## 2. Editing revisions

| # | Feature | Pri | Backed by |
|---|---|---|---|
| 2.1 | **Describe** any revision: inline edit or a multi-line editor tab | P0 | `jj describe -r X -m` |
| 2.2 | **New** revision: on top of X, after X (insert), before X, or merge of a selection | P0 | `jj new X`, `jj new -A/-B`, `jj new X Y` |
| 2.3 | **Edit** (check out) a revision | P0 | `jj edit X` |
| 2.4 | **Abandon** revision(s), with confirmation | P0 | `jj abandon` |
| 2.5 | **Squash** into parent, or into any chosen revision | P0 | `jj squash -r X`, `jj squash --from X --into Y` |
| 2.6 | **Split** a revision by picking files | P1 | `jj split -r X <paths>` |
| 2.7 | **Move individual files** between revisions: drag a file from one revision's file list onto another revision, or right-click a file → "Move to revision…" and pick a target. Works for one or many selected files | P0 | `jj squash --from X --into Y <path>` |
| 2.8 | **Absorb** working-copy changes into the stack | P1 | `jj absorb` |
| 2.9 | **Duplicate** a revision | P2 | `jj duplicate` |
| 2.10 | **Restore** a file to its parent's version | P1 | `jj restore -r X <path>` |
| 2.11 | Copy change ID / commit ID | P0 | |

## 3. Rebase

The rebase dialog exposes all of `jj rebase`, with a live before/after preview of the graph.

| # | Feature | Pri | Backed by |
|---|---|---|---|
| 3.1 | **What to move**: just this revision (`-r`), this revision and its descendants (`-s`), or the whole branch (`-b`) | P0 | `jj rebase -r/-s/-b` |
| 3.2 | **Where to put it**: onto (`-o`), insert after (`-A`), insert before (`-B`) | P0 | |
| 3.3 | **Drag and drop**: drag a node onto another node; modifier keys pick the mode (default `-s -o`; hold Alt for `-r`, Shift for `-b`) and a hint shows the resulting command | P0 | |
| 3.4 | **Rebase on main**: one click on a stack rebases onto `trunk()` after an optional fetch | P0 | `jj git fetch && jj rebase -b X -o 'trunk()'` |
| 3.5 | **Rebase all my stacks on main** | P1 | `jj rebase -s 'roots(trunk()..mine())' -o 'trunk()'` |
| 3.6 | Reorder within a stack (move up/down) | P1 | `jj rebase -r X -A/-B Y` |
| 3.7 | Add/remove a parent (create or undo a merge) | P2 | `jj rebase -s X -o A -o B` |
| 3.8 | Warn before a rebase that would rewrite immutable revisions or create conflicts | P1 | dry run against a temp op, then `jj op restore` |

## 4. Bookmarks (branches)

| # | Feature | Pri | Backed by |
|---|---|---|---|
| 4.1 | **Create** a bookmark on any revision | P0 | `jj bookmark create -r X` |
| 4.2 | **Move** a bookmark: drag the bookmark chip to another row, or pick a target (with `--allow-backwards` confirm) | P0 | `jj bookmark set/move` |
| 4.3 | Rename, delete, forget | P1 | `jj bookmark rename/delete/forget` |
| 4.4 | Track / untrack remote bookmarks | P1 | `jj bookmark track/untrack` |
| 4.5 | Show local vs remote position when they differ (ahead/behind/conflicted) | P0 | `jj bookmark list --all` |
| 4.6 | **Advance** the closest bookmark to `@` | P2 | `jj bookmark advance` |

## 5. Remote: fetch and push

| # | Feature | Pri | Backed by |
|---|---|---|---|
| 5.1 | **Fetch** (all remotes or pick one) | P0 | `jj git fetch` |
| 5.2 | **Push a bookmark** | P0 | `jj git push -b NAME` |
| 5.3 | **Push a revision without a bookmark** (auto-named bookmark) | P0 | `jj git push -c X` |
| 5.4 | Push all tracked bookmarks in a stack | P1 | `jj git push -r 'stack'` |
| 5.5 | Show a preview of what a push will do | P1 | `jj git push --dry-run` |
| 5.6 | Clear error messages for failed safety checks, with a "Fetch and retry" button | P0 | |

## 6. GitHub pull requests

Uses `gh` (already installed and logged in). We can switch to VS Code's GitHub auth later if needed.

| # | Feature | Pri | Backed by |
|---|---|---|---|
| 6.1 | **Create a PR** from a revision: pushes (creating a bookmark if needed), then opens a form with title/body pre-filled from the description, base branch, draft toggle | P0 | `jj git push -c/-b`, `gh pr create --head --base` |
| 6.2 | **Move a PR to a new revision**: pick the PR's bookmark, choose a target revision, force-move and push | P0 | `jj bookmark set NAME -r Y --allow-backwards && jj git push -b NAME` |
| 6.3 | Open the PR in the browser; copy its URL | P0 | `gh pr view --web` |
| 6.4 | **Stacked PRs**: create a PR per revision in a stack, each based on the one below; when the stack is rebased, update bases and push everything | P1 | `gh pr create/edit --base` |
| 6.5 | PR status in the graph (state, checks, reviews) | P1 | `gh pr list --json` |
| 6.6 | Change the base, mark ready, or close a PR | P2 | `gh pr edit/ready/close` |
| 6.7 | After a PR merges: offer to fetch, rebase the rest of the stack on main, and delete the bookmark | P1 | |

## 7. Safety, history and undo

| # | Feature | Pri | Backed by |
|---|---|---|---|
| 7.1 | **Undo / redo** buttons for the last operation | P0 | `jj undo`, `jj redo` |
| 7.2 | **Operation log** view: list of ops with descriptions; restore to any op | P1 | `jj op log`, `jj op restore` |
| 7.3 | **Evolution log** for a revision (how it changed over time), with diffs between versions | P2 | `jj evolog` |
| 7.4 | Command echo: an output channel shows each `jj` command run and its result, so users learn the CLI | P0 | |
| 7.5 | Confirm destructive actions (abandon, force-move a bookmark backwards, rewrite pushed commits) | P0 | |

## 8. Conflicts

| # | Feature | Pri | Backed by |
|---|---|---|---|
| 8.1 | Conflict markers on graph nodes and a list of conflicted files | P0 | template `conflict` |
| 8.2 | Open a conflicted file at a revision; "resolve" button launches the configured merge tool | P1 | `jj resolve` |
| 8.3 | Divergent change warning, with a guided fix (abandon one side) | P2 | |

## 9. VS Code integration

| # | Feature | Pri |
|---|---|---|
| 9.1 | Context menus, command palette entries and keybindings for every action | P0 |
| 9.2 | SCM provider: working-copy changes in the Source Control view, with gutter quick-diff against `@-` | P1 |
| 9.3 | Status bar item: current change ID, description, bookmark; click to describe | P1 |
| 9.4 | Multi-root / multiple jj repos in one workspace (repo picker, like the "inboxforge-ui" header) | P1 |
| 9.5 | Settings: `jj` path, default revset, auto-fetch interval, confirmation toggles | P0 |
| 9.6 | Light/dark theme support with VS Code theme colors | P0 |

---

## Suggested additions: approved for development

All suggested additions are in the development list above (and, like everything here, visible in the UI from the first release):

- **Undo/redo and op log (7.1, 7.2)**: jj's biggest safety net; makes drag-and-drop editing feel safe.
- **Drag-and-drop rebase and bookmark move (3.3, 4.2)**: the main reason to have a visual tool.
- **Squash, split and move files between revisions (2.5–2.7)**: the edits jj users do most. Moving files is P0.
- **New / edit / abandon / absorb / restore / duplicate (2.2–2.4, 2.8–2.10)**.
- **Stacked PRs, PR status badges, post-merge cleanup (6.4, 6.5, 6.7)**: jj's model fits stacked PRs well, and keeping them in sync by hand is painful.
- **Rebase preview and conflict warning (3.8)**: shows conflicts before you commit to a rebase.
- **Conflict markers and divergent-change help (8.1–8.3)**.
- **Command echo (7.4)**: builds trust and teaches the CLI.
- **VS Code integration: SCM view, status bar, multi-repo (9.2–9.4)**.

## Out of scope (for now)

- Non-GitHub forges (GitLab, Gitea)
- Working-copy hunk staging UI (jj has no index; `split` covers this)
- Workspaces management (`jj workspace`)
- Rewriting the jj backend or using jj-lib directly; we shell out to the CLI

## Decisions (approved 2026-10-23)

1. **Graph rendering**: Webview (custom graph with drag-and-drop).
2. **GitHub auth**: `gh` CLI first; VS Code GitHub sign-in may come later.
3. **PR bookmark naming**: jj's default `push-<changeid>`, with an optional configurable prefix setting.
4. **Default revset**: jj's own default (respects the user's `revsets.log` config); "Mine" is one click away in the presets.
5. **MVP cut**: P0 as listed is the first release.
