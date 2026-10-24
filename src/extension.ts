import * as vscode from "vscode";
import { basename } from "node:path";
import { JjRepo } from "./jj/repo";
import { GitHub, githubSlug } from "./github/gh";
import { Controller } from "./controller";
import { GraphViewProvider } from "./views/graphView";
import { openCreatePullRequest, openRebaseDialog } from "./views/panels";
import type { Action } from "./shared/protocol";
import type { Revision } from "./shared/types";
import { shortChangeId } from "./shared/types";

function config() {
  return vscode.workspace.getConfiguration("visualJujutsu");
}

async function findRepoRoot(jjPath: string): Promise<string | null> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = await JjRepo.findRoot(jjPath, folder.uri.fsPath);
    if (root) return root;
  }
  return null;
}

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Visual Jujutsu");
  context.subscriptions.push(output);
  const log = { append: (line: string) => output.appendLine(line) };
  const jjPath = () => config().get<string>("jjPath", "jj");

  const root = await findRepoRoot(jjPath());
  if (!root) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(GraphViewProvider.viewId, {
        resolveWebviewView(view) {
          view.webview.html = `<body style="padding:12px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)">
            <p>No jj repository found in this workspace.</p>
            <p>Run <code>jj git init --colocate</code> in your project, then reload the window.</p></body>`;
        },
      }),
    );
    return;
  }

  const repo = new JjRepo(jjPath, root, log);
  const github = await createGitHub(repo, root, log);
  const controller = new Controller(repo, github, output, basename(root));
  const provider = new GraphViewProvider(context.extensionUri, controller);
  context.subscriptions.push(
    controller,
    provider,
    vscode.window.registerWebviewViewProvider(GraphViewProvider.viewId, provider),
    vscode.workspace.registerTextDocumentContentProvider("jj-rev", {
      async provideTextDocumentContent(uri) {
        const rev = new URLSearchParams(uri.query).get("rev") ?? "@";
        try {
          return await repo.fileContent(rev, uri.path.replace(/^\//, ""));
        } catch {
          return ""; // The file doesn't exist on that side of the diff.
        }
      },
    }),
  );

  registerCommands(context, controller);
  context.subscriptions.push(
    vscode.commands.registerCommand("visualJujutsu.internal.debugState", () => ({ webviewReady: provider.webviewReady })),
  );
  watchRepo(context, controller, root);
  context.subscriptions.push(statusBar(controller));
  void controller.refresh();
}

async function createGitHub(repo: JjRepo, root: string, log: { append(line: string): void }) {
  try {
    const remotes = await repo.remotes();
    const remote = remotes.find((r) => r.name === "origin" && githubSlug(r.url)) ?? remotes.find((r) => githubSlug(r.url));
    const slug = remote && githubSlug(remote.url);
    return slug ? new GitHub(() => config().get<string>("ghPath", "gh"), root, log, slug) : null;
  } catch {
    return null;
  }
}

function registerCommands(context: vscode.ExtensionContext, controller: Controller) {
  const reg = (id: string, fn: (...args: any[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  const run = (action: Action) => controller.run(action);

  /** Commands take a change id from the webview, or ask for one from the palette. */
  const withRevision =
    (title: string, fn: (rev: string) => Action | void, filter?: (r: Revision) => boolean) =>
    async (changeId?: string) => {
      const id = typeof changeId === "string" ? changeId : (await controller.pickRevision(title, filter))?.changeId;
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
  reg("visualJujutsu.internal.openRebaseDialog", (changeId: string) => openRebaseDialog(context.extensionUri, controller, changeId));
  reg("visualJujutsu.internal.openCreatePullRequest", (changeId: string) =>
    openCreatePullRequest(context.extensionUri, controller, changeId),
  );
}

/** Refreshes when jj records a new operation or a file is saved. */
function watchRepo(context: vscode.ExtensionContext, controller: Controller, root: string) {
  let timer: NodeJS.Timeout | undefined;
  const schedule = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void controller.refresh(), ms);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, ".jj/repo/op_heads/heads/*"));
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => schedule(150)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.fsPath.startsWith(root)) schedule(800);
    }),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) schedule(300);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("visualJujutsu")) schedule(0);
    }),
    { dispose: () => clearTimeout(timer) },
  );
}

function statusBar(controller: Controller): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = "visualJujutsu.describe";
  const sub = controller.onDidChangeState((state) => {
    const wc = state.revisions.find((r) => r.isWorkingCopy);
    if (!wc) return item.hide();
    const desc = wc.description.split("\n")[0].trim() || "(no description)";
    const conflicts = state.revisions.filter((r) => r.conflict).length;
    item.text = `$(git-commit) ${shortChangeId(wc)} · ${desc}${conflicts ? `  $(warning) ${conflicts}` : ""}`;
    item.tooltip = "Working copy (@). Click to describe.";
    item.command = { command: "visualJujutsu.describe", title: "Describe", arguments: [wc.changeId] };
    item.show();
  });
  return { dispose: () => (sub.dispose(), item.dispose()) };
}

export function deactivate() {}
