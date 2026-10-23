# Visual Jujutsu

A VS Code extension for [Jujutsu (jj)](https://github.com/jj-vcs/jj): see your revision graph and change it directly.

- **Graph** of revisions with bookmarks, tags, PR badges, conflicts and the working copy, filtered by any revset.
- **Describe** inline, **new** (on top / insert after / before / merge), **edit**, **abandon**, **squash**.
- **Move files between revisions** by dragging them from one revision to another.
- **Rebase** by drag and drop (⌥ = only this revision, ⇧ = whole branch, drop on a row's edge to insert before/after), from the context menu, or with the rebase dialog. One-click **rebase on main**.
- **Bookmarks**: create, drag a chip to move it, push.
- **GitHub pull requests** (via `gh`): create (stack-aware base), move a PR to another revision, open it.
- **Undo / redo**, and a command log showing every `jj` and `gh` command the extension runs.

Features that are designed but not built yet still appear in the UI and say “not supported yet”. See [FEATURES.md](FEATURES.md) for the full plan and priorities.

## Requirements

- `jj` 0.46 or later on your PATH (or set `visualJujutsu.jjPath`).
- For pull requests: the GitHub CLI `gh`, logged in, and a GitHub remote.

## Development

```bash
npm install
npm run build        # bundles dist/extension.js and dist/webview.js
npm test             # unit + integration tests (needs jj)
npm run test:e2e     # runs the extension inside VS Code against a scratch repo
```

Press F5 in VS Code to launch an Extension Development Host. To work on the UI in a browser, serve the repo (`python3 -m http.server 5178`) and open `webview/dev.html?mode=graph` (or `rebase`, `createPr`); it uses a fake host with sample data.
