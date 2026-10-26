import * as vscode from "vscode";
import { RepoManager } from "./repoManager";
import { GraphViewProvider } from "./views/graphView";
import { JjSourceControl } from "./views/scm";
import { openCreatePullRequest, openRebaseDialog } from "./views/panels";
import type { Action } from "./shared/protocol";
import type { GraphState, Revision } from "./shared/types";
import { shortChangeId } from "./shared/types";

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Visual Jujutsu");
  context.subscriptions.push(output);
  const log = { append: (line: string) => output.appendLine(line) };

  const repos = new RepoManager(context, output, log);
  context.subscriptions.push(repos);
  if ((await repos.discover()) === 0) {
    showNoRepo(context, repos);
    return;
  }

  const provider = new GraphViewProvider(context.extensionUri, repos);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(GraphViewProvider.viewId, provider),
    vscode.workspace.registerTextDocumentContentProvider("jj-rev", {
      async provideTextDocumentContent(uri) {
        const query = new URLSearchParams(uri.query);
        const repo = repos.get(query.get("root"))?.repo;
        try {
          return (await repo?.fileContent(query.get("rev") ?? "@", uri.path.replace(/^\//, ""))) ?? "";
        } catch {
          return ""; // The file doesn't exist on that side of the diff.
        }
      },
    }),
  );

  registerCommands(context, repos);
  context.subscriptions.push(
    vscode.commands.registerCommand("visualJujutsu.internal.debugState", () => ({
      webviewReady: provider.webviewReady,
      repos: repos.list().map((r) => ({ ...r, scm: repos.get(r.root)?.scm.paths ?? [] })),
      active: repos.active?.root,
    })),
    statusBar(repos),
  );
}

/** The graph view when no repo was found, with the reason when jj couldn't run. */
function showNoRepo(context: vscode.ExtensionContext, repos: RepoManager) {
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const settings = `command:workbench.action.openSettings?${encodeURIComponent(JSON.stringify("visualJujutsu.jjPath"))}`;
  const body = repos.problem
    ? `<p>Visual Jujutsu couldn't run jj:</p>
       <pre style="white-space:pre-wrap">${escape(repos.problem)}</pre>
       <p>If jj is installed, set <a href="${settings}">visualJujutsu.jjPath</a> to its full path
       (run <code>which jj</code> in a terminal to find it).</p>`
    : `<p>No jj repository found in this workspace.</p>
       <p>Run <code>jj git init --colocate</code> in your project, then reload the window.</p>`;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GraphViewProvider.viewId, {
      resolveWebviewView(view) {
        view.webview.options = { enableCommandUris: true };
        view.webview.html = `<body style="padding:12px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)">${body}
          <p><a href="command:workbench.action.reloadWindow">Reload window</a></p></body>`;
      },
    }),
    // A new jjPath setting can find the repo; the graph needs a reload to show it.
    repos.onDidChangeRepos(async () => {
      const reload = await vscode.window.showInformationMessage("Visual Jujutsu found a jj repository. Reload the window to open it.", "Reload Window");
      if (reload) await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }),
  );
}

function registerCommands(context: vscode.ExtensionContext, repos: RepoManager) {
  const reg = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  const active = () => {
    const entry = repos.active;
    if (!entry) throw new Error("No jj repository is open.");
    return entry.controller;
  };
  const run = (action: Action) => active().run(action);

  /** Commands take a change id from the webview, or ask for one from the palette. */
  const withRevision =
    (title: string, fn: (rev: string) => Action | void, filter?: (r: Revision) => boolean) =>
    async (changeId?: string) => {
      const id = typeof changeId === "string" ? changeId : (await active().pickRevision(title, filter))?.changeId;
      if (!id) return;
      const action = fn(id);
      if (action) await run(action);
    };
  const mutable = (r: Revision) => !r.immutable;

  reg("visualJujutsu.refresh", () => run({ kind: "refresh" }));
  reg("visualJujutsu.fetch", () => run({ kind: "fetch" }));
  reg("visualJujutsu.push", () => run({ kind: "push" }));
  reg("visualJujutsu.undo", () => run({ kind: "undo" }));
  reg("visualJujutsu.redo", () => run({ kind: "redo" }));
  reg("visualJujutsu.showCommandLog", () => run({ kind: "showCommandLog" }));
  reg("visualJujutsu.describe", withRevision("Describe which revision?", (changeId) => ({ kind: "describePrompt", changeId }), mutable));
  reg("visualJujutsu.newRevision", withRevision("New revision on top of…", (changeId) => ({ kind: "new", changeIds: [changeId], mode: "onto" })));
  reg("visualJujutsu.edit", withRevision("Edit which revision?", (changeId) => ({ kind: "edit", changeId }), mutable));
  reg("visualJujutsu.abandon", withRevision("Abandon which revision?", (changeId) => ({ kind: "abandon", changeIds: [changeId] }), mutable));
  reg("visualJujutsu.squashIntoParent", withRevision("Squash which revision into its parent?", (changeId) => ({ kind: "squashIntoParent", changeId }), mutable));
  reg("visualJujutsu.rebase", withRevision("Rebase which revision?", (changeId) => ({ kind: "openRebaseDialog", changeId }), mutable));
  reg("visualJujutsu.rebaseOnTrunk", withRevision("Rebase which stack on main?", (changeId) => ({ kind: "rebaseOnTrunk", changeId }), mutable));
  reg("visualJujutsu.createBookmark", withRevision("Create a bookmark on…", (changeId) => ({ kind: "createBookmark", changeId })));
  reg("visualJujutsu.moveBookmark", withRevision("Move a bookmark to…", (changeId) => ({ kind: "moveBookmarkHere", changeId })));
  reg("visualJujutsu.createPullRequest", withRevision("Create a pull request from…", (changeId) => ({ kind: "openCreatePullRequest", changeId }), mutable));
  reg("visualJujutsu.movePullRequest", withRevision("Move a pull request to…", (changeId) => ({ kind: "movePullRequestHere", changeId }), mutable));
  reg("visualJujutsu.absorb", withRevision("Absorb changes from which revision?", (changeId) => ({ kind: "absorb", changeId }), mutable));
  reg("visualJujutsu.split", withRevision("Split which revision?", (changeId) => ({ kind: "split", changeId }), mutable));
  reg("visualJujutsu.rebaseAllOnTrunk", () => run({ kind: "rebaseAllOnTrunk" }));
  reg("visualJujutsu.trackBookmarks", () => run({ kind: "trackBookmarks" }));
  reg("visualJujutsu.switchRepository", async () => {
    const pick = await vscode.window.showQuickPick(
      repos.list().map((r) => ({ label: r.name, description: r.root, root: r.root, picked: r.root === repos.active?.root })),
      { title: "Show which jj repository in the graph?" },
    );
    if (pick) repos.setActive(pick.root);
  });
  reg("visualJujutsu.internal.scmDescribe", (scm: JjSourceControl) => scm.describe());
  reg("visualJujutsu.scmNewRevision", (sc?: vscode.SourceControl) => {
    const controller = repos.get(sc?.rootUri?.fsPath)?.controller ?? active();
    return controller.run({ kind: "new", changeIds: ["@"], mode: "onto" });
  });
  reg("visualJujutsu.internal.openRebaseDialog", (changeId: string) => openRebaseDialog(context.extensionUri, active(), changeId));
  reg("visualJujutsu.internal.openCreatePullRequest", (changeId: string) =>
    openCreatePullRequest(context.extensionUri, active(), changeId),
  );
}

/** Shows the active repo's working copy. */
function statusBar(repos: RepoManager): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = "visualJujutsu.describe";
  let sub: vscode.Disposable | undefined;
  const bind = () => {
    sub?.dispose();
    const controller = repos.active?.controller;
    if (!controller) return item.hide();
    if (controller.currentState) update(controller.currentState);
    sub = controller.onDidChangeState(update);
  };
  const update = (state: GraphState) => {
    const wc = state.revisions.find((r) => r.isWorkingCopy);
    if (!wc) return item.hide();
    const desc = wc.description.split("\n")[0].trim() || "(no description)";
    const conflicts = state.revisions.filter((r) => r.conflict).length;
    const repo = repos.list().length > 1 ? `${state.repoName}: ` : "";
    item.text = `$(git-commit) ${repo}${shortChangeId(wc)} · ${desc}${conflicts ? `  $(warning) ${conflicts}` : ""}`;
    item.tooltip = "Working copy (@). Click to describe.";
    item.command = { command: "visualJujutsu.describe", title: "Describe", arguments: [wc.changeId] };
    item.show();
  };
  bind();
  const activeSub = repos.onDidChangeActive(bind);
  return { dispose: () => (sub?.dispose(), activeSub.dispose(), item.dispose()) };
}

export function deactivate() {}
