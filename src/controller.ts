import * as vscode from "vscode";
import { CommandError } from "./jj/cli";
import { JjRepo, MIN_JJ_VERSION } from "./jj/repo";
import { GitHub } from "./github/gh";
import { layoutGraph } from "./shared/graph";
import type { Action, CreatePrDialogData, CreatePrRequest, RebaseDialogData, RebasePreview } from "./shared/protocol";
import type { ChangedFile, Density, GraphState, PullRequest, Revision, RevsetPreset } from "./shared/types";
import { shortChangeId } from "./shared/types";
import { expectedBase, stackFor, stackPrs, syncPlan, trunkBookmark } from "./shared/stacks";
import { revUri } from "./views/scm";

const ROADMAP_URL = "https://github.com/Brandon2255p/visual-jujutsu/blob/main/FEATURES.md";
const PR_REFRESH_MS = 60_000;

export const BUILT_IN_PRESETS: RevsetPreset[] = [
  { name: "Default", revset: "" },
  { name: "Mine", revset: "mine() | trunk() | @" },
  { name: "Stack of @", revset: "trunk()..@ | @:: | trunk()" },
  { name: "All", revset: "all()" },
  { name: "Bookmarks", revset: "bookmarks() | trunk() | @" },
];

function config() {
  return vscode.workspace.getConfiguration("visualJujutsu");
}

function firstLine(text: string) {
  return text.split("\n")[0].trim();
}

function revLabel(rev: Revision) {
  return `${shortChangeId(rev)} ${firstLine(rev.description) || "(no description set)"}`;
}

/** Owns the repo state and runs every user action. */
export class Controller implements vscode.Disposable {
  private readonly stateEmitter = new vscode.EventEmitter<GraphState>();
  readonly onDidChangeState = this.stateEmitter.event;
  private readonly busyEmitter = new vscode.EventEmitter<{ busy: boolean; label?: string }>();
  readonly onDidChangeBusy = this.busyEmitter.event;

  private revset: string;
  private revisions: Revision[] = [];
  private pullRequests: PullRequest[] = [];
  private localBookmarks: string[] = [];
  private prsFetchedAt = 0;
  private jjVersion = "";
  private state: GraphState | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;

  constructor(
    readonly repo: JjRepo,
    private readonly github: GitHub | null,
    private readonly output: vscode.OutputChannel,
    private readonly repoName: string,
  ) {
    this.revset = config().get<string>("defaultRevset", "");
  }

  dispose() {
    this.stateEmitter.dispose();
    this.busyEmitter.dispose();
  }

  get currentState() {
    return this.state;
  }

  presets(): RevsetPreset[] {
    return [...BUILT_IN_PRESETS, ...config().get<RevsetPreset[]>("savedRevsets", [])];
  }

  setRevset(revset: string) {
    this.revset = revset;
    return this.refresh();
  }

  /** Reloads the graph. Calls made while a refresh is running are merged into one more. */
  refresh(opts: { pullRequests?: boolean } = {}): Promise<void> {
    if (opts.pullRequests) this.prsFetchedAt = 0;
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = this.load().finally(() => {
      this.refreshing = null;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        void this.refresh();
      }
    });
    return this.refreshing;
  }

  private async load() {
    let error: string | null = null;
    try {
      if (!this.jjVersion) this.jjVersion = await this.repo.version();
      if (!this.repo.atLeast(MIN_JJ_VERSION)) {
        throw new Error(
          `Visual Jujutsu needs jj ${MIN_JJ_VERSION} or later, but found ${this.jjVersion}. ` +
            "Update jj: https://jj-vcs.github.io/jj/latest/install-and-setup/",
        );
      }
      const [revisions, lastOperation, bookmarks] = await Promise.all([
        this.repo.log(this.revset, config().get<number>("logLimit", 200)),
        this.repo.lastOperation(),
        this.repo.bookmarkNames(),
      ]);
      this.revisions = revisions.filter((r) => !r.root);
      this.localBookmarks = bookmarks;
      this.state = this.buildState(lastOperation, null);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      this.state = this.buildState(this.state?.lastOperation ?? null, error);
    }
    this.stateEmitter.fire(this.state);
    if (!error) void this.loadPullRequests();
  }

  private buildState(lastOperation: GraphState["lastOperation"], error: string | null): GraphState {
    return {
      repoName: this.repoName,
      root: this.repo.root,
      repos: [],
      jjVersion: this.jjVersion,
      revset: this.revset,
      presets: this.presets(),
      revisions: this.revisions,
      layout: layoutGraph(this.revisions),
      pullRequests: this.pullRequests,
      localBookmarks: this.localBookmarks,
      github: !!this.github,
      lastOperation,
      error,
      density: config().get<Density>("density", "comfortable"),
    };
  }

  private async loadPullRequests() {
    if (!this.github || Date.now() - this.prsFetchedAt < PR_REFRESH_MS) return;
    this.prsFetchedAt = Date.now();
    try {
      this.pullRequests = await this.github.pullRequests();
      if (this.state) {
        this.state = { ...this.state, pullRequests: this.pullRequests };
        this.stateEmitter.fire(this.state);
      }
    } catch (e) {
      this.output.appendLine(`Could not load pull requests: ${e instanceof Error ? e.message : e}`);
    }
  }

  files(changeId: string): Promise<ChangedFile[]> {
    return this.repo.files(changeId);
  }

  findRevision(changeId: string) {
    return this.revisions.find((r) => r.changeId === changeId);
  }

  // ---- Actions -----------------------------------------------------------

  async run(action: Action): Promise<void> {
    try {
      const changed = await this.perform(action);
      if (changed) await this.refresh();
    } catch (e) {
      this.reportError(action, e);
      await this.refresh();
    } finally {
      this.busyEmitter.fire({ busy: false });
    }
  }

  private busy(label: string) {
    this.busyEmitter.fire({ busy: true, label });
  }

  /** Returns true when the repo may have changed. */
  private async perform(action: Action): Promise<boolean> {
    const repo = this.repo;
    switch (action.kind) {
      case "refresh":
        await this.refresh({ pullRequests: true });
        return false;
      case "fetch":
        this.busy("Fetching…");
        await repo.fetch();
        this.prsFetchedAt = 0;
        return true;
      case "push":
        return this.pushPicked();
      case "undo":
        await repo.undo();
        return true;
      case "redo":
        await repo.redo();
        return true;
      case "showCommandLog":
        this.output.show(true);
        return false;
      case "describe":
        await repo.describe(action.changeId, action.message);
        return true;
      case "describePrompt": {
        const rev = this.findRevision(action.changeId);
        const message = await vscode.window.showInputBox({
          title: `Describe ${rev ? shortChangeId(rev) : action.changeId}`,
          value: rev?.description.trimEnd() ?? "",
          prompt: "Use the inline editor in the graph for multi-line descriptions.",
        });
        if (message === undefined) return false;
        await repo.describe(action.changeId, message);
        return true;
      }
      case "edit":
        await repo.edit(action.changeId);
        return true;
      case "new":
        await repo.newRevision(action.changeIds, action.mode);
        return true;
      case "abandon":
        return this.abandon(action.changeIds);
      case "squashIntoParent": {
        const parents = await repo.log(`${action.changeId}-`, 2);
        if (parents.length !== 1) throw new Error("Squash into parent needs exactly one parent. Use “Squash into…” instead.");
        return this.squash(action.changeId, parents[0]);
      }
      case "squashInto": {
        const into = action.into
          ? this.findRevision(action.into)
          : await this.pickRevision("Squash into which revision?", (r) => r.changeId !== action.from && !r.immutable);
        if (!into) return false;
        return this.squash(action.from, into);
      }
      case "moveFiles":
        this.busy("Moving files…");
        await repo.moveFiles(action.from, action.into, action.paths);
        return true;
      case "moveFilesPrompt": {
        const n = action.paths.length;
        const into = await this.pickRevision(
          `Move ${n === 1 ? action.paths[0] : `${n} files`} into…`,
          (r) => r.changeId !== action.from && !r.immutable,
        );
        if (!into) return false;
        this.busy("Moving files…");
        await repo.moveFiles(action.from, into.changeId, action.paths);
        return true;
      }
      case "openSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "visualJujutsu");
        return false;
      case "rebase": {
        let destination = action.destination;
        if (!destination) {
          const pick = await this.pickRevision(
            `Rebase ${this.label(action.changeId)} ${action.target === "o" ? "onto" : action.target === "A" ? "after" : "before"}…`,
            (r) => r.changeId !== action.changeId,
          );
          if (!pick) return false;
          destination = pick.changeId;
        }
        this.busy("Rebasing…");
        await repo.rebase(action.source, action.changeId, action.target, destination, action.skipEmptied);
        return true;
      }
      case "rebaseOnTrunk":
        if (config().get<boolean>("fetchBeforeRebaseOnTrunk", true)) {
          this.busy("Fetching…");
          await repo.fetch();
        }
        this.busy("Rebasing on main…");
        await repo.rebase("b", action.changeId, "o", "trunk()");
        return true;
      case "openRebaseDialog":
        await vscode.commands.executeCommand("visualJujutsu.internal.openRebaseDialog", action.changeId);
        return false;
      case "createBookmark": {
        const name = await vscode.window.showInputBox({
          title: `Create bookmark on ${this.label(action.changeId)}`,
          placeHolder: "bookmark-name",
          validateInput: (v) => (/^[^\s~^:?*[\\]+$/.test(v) ? null : "Enter a bookmark name without spaces"),
        });
        if (!name) return false;
        await repo.createBookmark(name, action.changeId);
        return true;
      }
      case "moveBookmark":
        return this.moveBookmark(action.name, action.to);
      case "moveBookmarkHere": {
        const names = await repo.bookmarkNames();
        const name = await vscode.window.showQuickPick(names, { title: `Move which bookmark to ${this.label(action.changeId)}?` });
        if (!name) return false;
        return this.moveBookmark(name, action.changeId);
      }
      case "pushBookmark":
        this.busy(`Pushing ${action.name}…`);
        await repo.push({ bookmarks: [action.name] });
        this.prsFetchedAt = 0;
        return true;
      case "pushChange":
        this.busy("Pushing…");
        await repo.push({ changes: [action.changeId] });
        return true;
      case "openCreatePullRequest":
        await vscode.commands.executeCommand("visualJujutsu.internal.openCreatePullRequest", action.changeId);
        return false;
      case "movePullRequestHere":
        return this.movePullRequestHere(action.changeId);
      case "openPullRequest":
        await vscode.env.openExternal(vscode.Uri.parse(action.url));
        return false;
      case "copy":
        await vscode.env.clipboard.writeText(action.text);
        vscode.window.setStatusBarMessage(`Copied ${action.label}`, 2000);
        return false;
      case "openDiff":
        await this.openDiff(action.changeId, action.path);
        return false;
      case "split":
        return this.split(action.changeId, action.paths);
      case "absorb":
        this.busy("Absorbing…");
        await repo.absorb(action.changeId);
        return true;
      case "restoreFiles": {
        const n = action.paths.length;
        const what = n === 1 ? action.paths[0] : `${n} files`;
        const ok = await this.confirm(
          `Discard changes to ${what} in ${this.label(action.changeId)}?`,
          "The files go back to their version in the parent revision. You can undo this.",
          "Discard changes",
        );
        if (!ok) return false;
        await repo.restoreFiles(action.changeId, action.paths);
        return true;
      }
      case "reorder":
        return this.reorder(action.changeId, action.direction);
      case "rebaseMany": {
        const ids = new Set(action.changeIds);
        const dest = await this.pickRevision(`Rebase ${ids.size} revisions onto…`, (r) => !ids.has(r.changeId));
        if (!dest) return false;
        this.busy("Rebasing…");
        await repo.rebaseMany("r", action.changeIds, "o", dest.changeId);
        return true;
      }
      case "squashMany": {
        const ids = new Set(action.changeIds);
        const into = await this.pickRevision(`Squash ${ids.size} revisions into…`, (r) => !ids.has(r.changeId) && !r.immutable);
        if (!into) return false;
        const message = [into, ...action.changeIds.map((id) => this.findRevision(id))]
          .map((r) => r?.description.trim() ?? "")
          .filter((d, i, all) => d && all.indexOf(d) === i)
          .join("\n\n");
        await repo.squashMany(action.changeIds, into.changeId, message);
        return true;
      }
      case "rebaseAllOnTrunk":
        if (config().get<boolean>("fetchBeforeRebaseOnTrunk", true)) {
          this.busy("Fetching…");
          await repo.fetch();
        }
        this.busy("Rebasing all stacks on main…");
        await repo.rebaseAllOnTrunk();
        return true;
      case "renameBookmark": {
        const name = await this.pickBookmark(action.changeId, "Rename which bookmark?");
        if (!name) return false;
        const newName = await vscode.window.showInputBox({
          title: `Rename bookmark “${name}”`,
          value: name,
          validateInput: (v) => (/^[^\s~^:?*[\\]+$/.test(v) ? null : "Enter a bookmark name without spaces"),
        });
        if (!newName || newName === name) return false;
        await repo.renameBookmark(name, newName);
        return true;
      }
      case "deleteBookmark": {
        const name = await this.pickBookmark(action.changeId, "Delete which bookmark?");
        if (!name) return false;
        const ok = await this.confirm(
          `Delete bookmark “${name}”?`,
          "It is also deleted on the remote the next time you push. To remove it only locally, use Forget.",
          "Delete",
        );
        if (!ok) return false;
        await repo.deleteBookmarks([name]);
        return true;
      }
      case "forgetBookmark": {
        const name = await this.pickBookmark(action.changeId, "Forget which bookmark?");
        if (!name) return false;
        await repo.forgetBookmarks([name]);
        return true;
      }
      case "trackBookmarks":
        return this.trackBookmarks();
      case "pushStack":
        return this.pushWithPreview({ revisions: `trunk()..${action.changeId}` }, `bookmarks in the stack up to ${this.label(action.changeId)}`);
      case "resolveConflicts":
        this.resolveInTerminal(action.changeId, action.path);
        return false;
      case "openWorkingCopyFile":
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.joinPath(vscode.Uri.file(this.repo.root), action.path));
        return false;
      case "restoreOperation": {
        const ok = await this.confirm(
          "Restore the repo to this operation?",
          `“${action.description}”\n\nEverything after it is undone (jj op restore). The restore is itself an operation, so you can undo it.`,
          "Restore",
        );
        if (!ok) return false;
        this.busy("Restoring…");
        await repo.restoreOperation(action.id);
        return true;
      }
      case "syncStack": {
        const changeId = action.changeId ?? (action.bookmark ? (await repo.changeIds(this.bookmarkRevset(action.bookmark), 1))[0] : undefined);
        if (!changeId) throw new Error(`Bookmark “${action.bookmark}” is not in this repo.`);
        return this.syncStack(changeId);
      }
      case "createStackPrs":
        return this.createStackPrs(action.changeId);
      case "cleanUpMergedPr":
        return this.cleanUpMergedPr(action.number);
      case "switchRepo":
        // Handled by the graph view, which owns the active repo.
        return false;
      case "setDensity":
        // A user setting: density is a preference, not a property of the repo.
        try {
          await config().update("density", action.density, vscode.ConfigurationTarget.Global);
        } catch (e) {
          // Right after an update, a window that hasn't reloaded can run the new code
          // before it knows the new settings ("… is not a registered configuration").
          if (!/not a registered configuration/i.test(String(e))) throw e;
          const reload = "Reload Window";
          const choice = await vscode.window.showWarningMessage(
            "VS Code hasn't loaded Visual Jujutsu's new settings yet. Reload the window to finish the update, then try again.",
            reload,
          );
          if (choice === reload) await vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
        return false;
      case "duplicate":
        this.busy("Duplicating…");
        await repo.duplicate(action.changeId);
        return true;
      case "prChangeBase":
        return this.prChangeBase(action.number);
      case "prMarkReady":
        this.busy(`Marking PR #${action.number} ready…`);
        await this.requireGitHub().markReady(action.number);
        this.prsFetchedAt = 0;
        return true;
      case "prClose":
        return this.prClose(action.number);
      case "openVersionDiff": {
        const uri = (rev: string) => revUri(this.repo.root, rev, action.path);
        await vscode.commands.executeCommand("vscode.diff", uri(action.from), uri(action.to), action.title);
        return false;
      }
      case "restoreVersion": {
        const ok = await this.confirm(
          `Restore ${this.label(action.changeId)} to version ${action.label}?`,
          "Its files go back to how they were in that version. The description is kept. You can undo this.",
          "Restore",
        );
        if (!ok) return false;
        await repo.restoreFrom(action.commitId, action.changeId);
        return true;
      }
      case "resolveDivergence":
        return this.resolveDivergence(action.changeId);
      case "notSupported":
        void this.notSupported(action.feature);
        return false;
    }
  }

  async notSupported(feature: string) {
    const choice = await vscode.window.showInformationMessage(`“${feature}” is not supported yet.`, "View roadmap");
    if (choice) await vscode.env.openExternal(vscode.Uri.parse(ROADMAP_URL));
  }

  private label(changeId: string) {
    const rev = this.findRevision(changeId);
    return rev ? shortChangeId(rev) : changeId.slice(0, 8);
  }

  async pickRevision(title: string, filter: (r: Revision) => boolean = () => true): Promise<Revision | undefined> {
    const items = this.revisions.filter(filter).map((r) => ({
      label: `${r.isWorkingCopy ? "$(circle-filled) " : ""}${shortChangeId(r)}`,
      description: firstLine(r.description) || "(no description set)",
      detail: r.localBookmarks.map((b) => b.name).join(", ") || undefined,
      rev: r,
    }));
    const pick = await vscode.window.showQuickPick(items, { title, matchOnDescription: true, matchOnDetail: true });
    return pick?.rev;
  }

  private async confirm(message: string, detail: string, button: string) {
    if (!config().get<boolean>("confirmDestructiveActions", true)) return true;
    const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, button);
    return choice === button;
  }

  private async abandon(changeIds: string[]) {
    const revs = changeIds.map((id) => this.findRevision(id));
    const names = revs.map((r, i) => (r ? revLabel(r) : changeIds[i])).join("\n");
    const bookmarks = revs.flatMap((r) => r?.localBookmarks.map((b) => b.name) ?? []);
    const detail =
      `${names}\n\nDescendants are rebased onto the parent.` +
      (bookmarks.length ? ` Bookmarks ${bookmarks.join(", ")} will be deleted on the next push.` : "") +
      "\n\nYou can undo this.";
    const n = changeIds.length;
    if (!(await this.confirm(`Abandon ${n} revision${n === 1 ? "" : "s"}?`, detail, "Abandon"))) return false;
    await this.repo.abandon(changeIds);
    return true;
  }

  private async squash(from: string, into: Revision) {
    const source = this.findRevision(from) ?? (await this.repo.log(from, 1))[0];
    const a = into.description.trim();
    const b = source.description.trim();
    const message = a && b && a !== b ? `${a}\n\n${b}` : a || b;
    await this.repo.squash(from, into.changeId, message);
    return true;
  }

  private async moveBookmark(name: string, to: string) {
    try {
      await this.repo.setBookmark(name, to, false);
    } catch (e) {
      if (!(e instanceof CommandError) || !/backwards|sideways/i.test(e.stderr)) throw e;
      const ok = await this.confirm(
        `Move bookmark “${name}” backwards or sideways?`,
        `${this.label(to)} is not a descendant of where “${name}” is now. Revisions only reachable from the old position will no longer be on this bookmark.`,
        "Move",
      );
      if (!ok) return false;
      await this.repo.setBookmark(name, to, true);
    }
    return true;
  }

  private async pushPicked() {
    const names = await this.repo.bookmarkNames();
    const all = { label: "$(cloud-upload) All tracked bookmarks", description: "jj git push", value: null as string | null };
    const items = [all, ...names.map((n) => ({ label: n, description: "", value: n as string | null }))];
    const picks = await vscode.window.showQuickPick(items, { title: "Push to origin", canPickMany: true });
    if (!picks || picks.length === 0) return false;
    if (picks.some((p) => p.value === null)) return this.pushWithPreview({}, "all tracked bookmarks");
    const bookmarks = picks.map((p) => p.value!);
    return this.pushWithPreview({ bookmarks }, bookmarks.length === 1 ? `“${bookmarks[0]}”` : `${bookmarks.length} bookmarks`);
  }

  /** Shows jj's dry-run report, then pushes if the user confirms. */
  private async pushWithPreview(target: { bookmarks?: string[]; revisions?: string }, what: string) {
    this.busy("Checking what would be pushed…");
    const report = await this.repo.push({ ...target, dryRun: true });
    this.busyEmitter.fire({ busy: false });
    const lines = report
      .split("\n")
      .filter((l) => l.trim() && !/dry-run requested/i.test(l))
      .join("\n");
    if (/nothing changed/i.test(report) || !lines) {
      void vscode.window.showInformationMessage(`Nothing to push for ${what}.`);
      return false;
    }
    const choice = await vscode.window.showInformationMessage(`Push ${what}?`, { modal: true, detail: lines }, "Push");
    if (choice !== "Push") return false;
    this.busy("Pushing…");
    await this.repo.push(target);
    this.prsFetchedAt = 0;
    return true;
  }

  private async split(changeId: string, paths?: string[]) {
    let selected = paths;
    if (!selected) {
      const files = await this.repo.files(changeId);
      if (files.length < 2) {
        void vscode.window.showInformationMessage("Splitting needs a revision with at least two changed files.");
        return false;
      }
      const picks = await vscode.window.showQuickPick(
        files.map((f) => ({ label: f.path, description: `+${f.added} −${f.removed}` })),
        { title: `Split ${this.label(changeId)}: pick the files for the first revision`, canPickMany: true },
      );
      if (!picks || picks.length === 0 || picks.length === files.length) return false;
      selected = picks.map((p) => p.label);
    }
    await this.repo.split(changeId, selected);
    return true;
  }

  /** Swaps a revision with its only child (up) or its parent (down). */
  private async reorder(changeId: string, direction: "up" | "down") {
    if (direction === "up") {
      const children = await this.repo.log(`children(${changeId})`, 3);
      if (children.length !== 1) throw new Error("Move up needs exactly one child to swap with.");
      await this.repo.rebase("r", changeId, "A", children[0].changeId);
    } else {
      const parents = await this.repo.log(`${changeId}-`, 3);
      if (parents.length !== 1 || parents[0].immutable) throw new Error("Move down needs a single mutable parent to swap with.");
      await this.repo.rebase("r", changeId, "B", parents[0].changeId);
    }
    return true;
  }

  private async pickBookmark(changeId: string, title: string) {
    const names = this.findRevision(changeId)?.localBookmarks.map((b) => b.name) ?? [];
    if (names.length <= 1) return names[0];
    return vscode.window.showQuickPick(names, { title });
  }

  private async trackBookmarks() {
    const refs = await this.repo.remoteBookmarks();
    if (refs.length === 0) {
      void vscode.window.showInformationMessage("There are no remote bookmarks. Fetch first?");
      return false;
    }
    const items = refs.map((r) => ({ label: `${r.name}@${r.remote}`, description: r.tracked ? "tracked" : "", picked: r.tracked, ref: r }));
    const picks = await vscode.window.showQuickPick(items, {
      title: "Tracked remote bookmarks (checked = tracked)",
      canPickMany: true,
    });
    if (!picks) return false;
    const want = new Set(picks.map((p) => p.label));
    let changed = false;
    for (const { ref, label } of items) {
      if (want.has(label) && !ref.tracked) await this.repo.trackBookmark(ref.name, ref.remote);
      else if (!want.has(label) && ref.tracked) await this.repo.untrackBookmark(ref.name, ref.remote);
      else continue;
      changed = true;
    }
    return changed;
  }

  /** Merge tools are interactive, so jj resolve runs in a terminal; the graph refreshes when it finishes. */
  private resolveInTerminal(changeId: string, path?: string) {
    const jj = config().get<string>("jjPath", "jj");
    const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const args = ["resolve", "-r", changeId, ...(path ? ["--", quote(`root-file:${JSON.stringify(path)}`)] : [])];
    const terminal = vscode.window.createTerminal({ name: `jj resolve ${this.label(changeId)}`, cwd: this.repo.root });
    terminal.show();
    terminal.sendText([quote(jj), ...args].join(" "));
    const sub = vscode.window.onDidCloseTerminal((t) => {
      if (t === terminal) {
        sub.dispose();
        void this.refresh();
      }
    });
  }

  evolog(changeId: string) {
    return this.repo.evolog(changeId);
  }

  versionFiles(from: string, to: string) {
    return this.repo.diffBetween(from, to);
  }

  operations(limit = 200) {
    return this.repo.operations(limit);
  }

  private async movePullRequestHere(changeId: string) {
    if (!this.github) throw new Error("Pull requests need a GitHub remote and the gh CLI.");
    if (Date.now() - this.prsFetchedAt > PR_REFRESH_MS) {
      this.prsFetchedAt = 0;
      await this.loadPullRequests();
    }
    const local = new Set(await this.repo.bookmarkNames());
    const open = this.pullRequests.filter((p) => p.state === "OPEN" && local.has(p.headRefName));
    if (open.length === 0) {
      void vscode.window.showInformationMessage("No open pull requests have a local bookmark.");
      return false;
    }
    const pick = await vscode.window.showQuickPick(
      open.map((p) => ({ label: `#${p.number} ${p.title}`, description: p.headRefName, pr: p })),
      { title: `Move which pull request to ${this.label(changeId)}?` },
    );
    if (!pick) return false;
    if (!(await this.moveBookmark(pick.pr.headRefName, changeId))) return false;
    this.busy(`Pushing ${pick.pr.headRefName}…`);
    await this.repo.push({ bookmarks: [pick.pr.headRefName] });
    this.prsFetchedAt = 0;
    return true;
  }

  private async openDiff(changeId: string, path: string) {
    const uri = (revset: string) => revUri(this.repo.root, revset, path);
    const name = path.split("/").pop();
    await vscode.commands.executeCommand("vscode.diff", uri(`${changeId}-`), uri(changeId), `${name} (${this.label(changeId)})`);
  }

  /** Shows the error without waiting for it to be dismissed, so the action can finish. */
  private reportError(action: Action, e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const summary = message.split("\n").find((l) => l.trim()) ?? message;
    const isPush = action.kind === "pushBookmark" || action.kind === "pushChange" || action.kind === "push" || action.kind === "movePullRequestHere";
    const buttons = isPush ? ["Fetch and retry", "Show command log"] : ["Show command log"];
    void vscode.window.showErrorMessage(summary.replace(/^Error:\s*/, ""), ...buttons).then(async (choice) => {
      if (choice === "Show command log") this.output.show(true);
      if (choice === "Fetch and retry") {
        await this.run({ kind: "fetch" });
        await this.run(action);
      }
    });
  }

  // ---- Dialog data -------------------------------------------------------

  rebaseDialogData(changeId: string): RebaseDialogData | null {
    const revision = this.findRevision(changeId);
    if (!revision) return null;
    const trunk = this.revisions.find((r) => r.inTrunk && r.localBookmarks.length > 0);
    return {
      revision,
      candidates: this.revisions.filter((r) => r.changeId !== changeId),
      defaultDestination: trunk?.changeId ?? null,
    };
  }

  async previewRebase(action: Extract<Action, { kind: "rebase" }>): Promise<RebasePreview> {
    const destination = action.destination ?? "trunk()";
    const { before, after } = await this.repo.previewRebase(action.source, action.changeId, action.target, destination, action.skipEmptied);
    const was = new Map(before.map((r) => [r.changeId, r]));
    return {
      before,
      after,
      moved: after.filter((r) => was.get(r.changeId)?.commitId !== r.commitId).map((r) => r.changeId),
      conflicts: after.filter((r) => r.conflict && !was.get(r.changeId)?.conflict).map((r) => r.changeId),
    };
  }

  async createPrDialogData(changeId: string): Promise<CreatePrDialogData | null> {
    const revisions = await this.stackRevisions(changeId);
    const revision = revisions.find((r) => r.changeId === changeId);
    if (!revision) return null;
    const stack = stackFor(revisions, changeId, this.pullRequests);
    const trunk = trunkBookmark(revisions);
    const { base, below } = expectedBase(stack, 0, trunk);
    const existing = revision.localBookmarks.map((b) => b.name);
    const newName = this.newPrBookmark(changeId);
    return {
      revision,
      headOptions: [...existing, newName],
      suggestedHead: existing[0] ?? newName,
      baseOptions: [...new Set([trunk, ...stack.slice(1).flatMap((s) => (s.bookmark && !s.revision.inTrunk ? [s.bookmark] : []))])],
      suggestedBase: base,
      baseReason: below
        ? `The revision below has PR #${below.pr!.number}, so this PR stacks on it. Pick ${trunk} to target trunk.`
        : `Targets ${trunk}.`,
      stack,
    };
  }

  // ---- Stacked pull requests ---------------------------------------------

  private bookmarkRevset(name: string) {
    return `bookmarks(exact:${JSON.stringify(name)})`;
  }

  private newPrBookmark(changeId: string) {
    return `${config().get<string>("pullRequestBookmarkPrefix", "push-")}${changeId.slice(0, 12)}`;
  }

  private requireGitHub(): GitHub {
    if (!this.github) throw new Error("Pull requests need a GitHub remote and the gh CLI.");
    return this.github;
  }

  /** The revision's ancestors down to trunk, independent of the graph's revset. */
  private async stackRevisions(changeId: string): Promise<Revision[]> {
    return this.repo.log(`(trunk()..${changeId}) | trunk()`, 100);
  }

  private async freshPullRequests() {
    this.prsFetchedAt = 0;
    await this.loadPullRequests();
    return this.pullRequests;
  }

  /**
   * Links the stack's open PRs into a native GitHub stack with `gh stack link`,
   * when that extension is installed and the setting allows it. Failures are
   * reported but don't undo the push or PRs.
   */
  private async linkGitHubStack(changeId: string) {
    const github = this.github;
    if (!github || !config().get<boolean>("linkGitHubStacks", true) || !(await github.hasStackExtension())) return;
    const revisions = await this.stackRevisions(changeId);
    const prs = stackPrs(stackFor(revisions, changeId, await this.freshPullRequests()));
    if (prs.length < 2) return;
    this.busy("Linking the stack on GitHub…");
    try {
      await github.linkStack(prs.map((p) => p.url), trunkBookmark(revisions));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      void vscode.window.showWarningMessage(`The PRs are stacked, but gh stack link failed: ${message}`);
    }
  }

  /** Pushes every bookmark in the stack and points each PR's base at the PR below it. */
  private async syncStack(changeId: string) {
    const github = this.requireGitHub();
    this.busy("Checking the stack…");
    const prs = await this.freshPullRequests();
    const revisions = await this.stackRevisions(changeId);
    const plan = syncPlan(stackFor(revisions, changeId, prs), trunkBookmark(revisions));
    const report = plan.push.length ? await this.repo.push({ bookmarks: plan.push, dryRun: true }) : "";
    this.busyEmitter.fire({ busy: false });
    const pushLines = report
      .split("\n")
      .filter((l) => l.trim() && !/dry-run requested|nothing changed/i.test(l));
    if (!pushLines.length && !plan.retarget.length) {
      await this.linkGitHubStack(changeId);
      void vscode.window.showInformationMessage("This stack is already in sync with GitHub.");
      return false;
    }
    const detail = [
      ...(pushLines.length ? [...pushLines, ""] : []),
      ...plan.retarget.map((r) => `PR #${r.pr.number}: change base from ${r.from} to ${r.to}`),
    ].join("\n");
    const choice = await vscode.window.showInformationMessage("Sync stack with GitHub?", { modal: true, detail }, "Sync");
    if (choice !== "Sync") return false;
    if (pushLines.length) {
      this.busy("Pushing the stack…");
      await this.repo.push({ bookmarks: plan.push });
    }
    for (const r of plan.retarget) {
      this.busy(`Updating PR #${r.pr.number}…`);
      await github.editBase(r.pr.number, r.to);
    }
    await this.linkGitHubStack(changeId);
    this.prsFetchedAt = 0;
    return true;
  }

  /** Opens a PR for every revision in the stack that doesn't have one, each based on the one below. */
  private async createStackPrs(changeId: string) {
    const github = this.requireGitHub();
    this.busy("Checking the stack…");
    const prs = await this.freshPullRequests();
    const revisions = await this.stackRevisions(changeId);
    const trunk = trunkBookmark(revisions);
    const entries = stackFor(revisions, changeId, prs)
      .filter((s) => !s.revision.inTrunk && !s.revision.immutable)
      .reverse();
    this.busyEmitter.fire({ busy: false });
    const missing = entries.filter((e) => !e.pr);
    if (!missing.length) {
      void vscode.window.showInformationMessage("Every revision in this stack already has a pull request.");
      return false;
    }
    const title = (r: Revision) => firstLine(r.description) || shortChangeId(r);
    const detail = missing.map((e) => `${shortChangeId(e.revision)}  ${title(e.revision)}  (${e.bookmark ?? this.newPrBookmark(e.revision.changeId)})`).join("\n");
    const n = missing.length;
    const choice = await vscode.window.showInformationMessage(
      `Create ${n} pull request${n === 1 ? "" : "s"} for this stack?`,
      { modal: true, detail: `${detail}\n\nEach PR is based on the one below it; the bottom one targets ${trunk}.` },
      "Create",
      "Create as drafts",
    );
    if (!choice) return false;
    for (const e of missing) {
      if (!e.bookmark) {
        e.bookmark = this.newPrBookmark(e.revision.changeId);
        await this.repo.createBookmark(e.bookmark, e.revision.changeId);
      }
    }
    this.busy("Pushing the stack…");
    await this.repo.push({ bookmarks: entries.map((e) => e.bookmark!) });
    let base = trunk;
    const urls: string[] = [];
    for (const e of entries) {
      if (!e.pr) {
        this.busy(`Creating PR for ${e.bookmark}…`);
        const [first, ...rest] = e.revision.description.trim().split("\n");
        urls.push(
          await github.createPullRequest({
            head: e.bookmark!,
            base,
            title: first?.trim() || title(e.revision),
            body: rest.join("\n").trim(),
            draft: choice === "Create as drafts",
          }),
        );
      }
      base = e.bookmark!;
    }
    await this.linkGitHubStack(changeId);
    this.prsFetchedAt = 0;
    void vscode.window.showInformationMessage(`Created ${urls.length} pull request${urls.length === 1 ? "" : "s"}.`, "Open on GitHub").then((c) => {
      if (c) urls.forEach((u) => void vscode.env.openExternal(vscode.Uri.parse(u)));
    });
    return true;
  }

  private async prChangeBase(number: number) {
    const github = this.requireGitHub();
    const pr = (await this.freshPullRequests()).find((p) => p.number === number);
    if (!pr) throw new Error(`PR #${number} not found.`);
    const trunk = trunkBookmark(this.revisions);
    const open = new Set(this.pullRequests.filter((p) => p.state === "OPEN").map((p) => p.headRefName));
    const names = [...new Set([trunk, ...this.localBookmarks])].filter((n) => n !== pr.headRefName);
    const items = names.map((name) => ({
      label: name,
      description: [name === pr.baseRefName && "current base", name === trunk && "trunk", open.has(name) && "has an open PR"].filter(Boolean).join(" · "),
    }));
    const pick = await vscode.window.showQuickPick(items, { title: `Change the base of PR #${number} (${pr.headRefName} → ${pr.baseRefName})` });
    if (!pick || pick.label === pr.baseRefName) return false;
    this.busy(`Updating PR #${number}…`);
    await github.editBase(number, pick.label);
    this.prsFetchedAt = 0;
    return true;
  }

  private async prClose(number: number) {
    const github = this.requireGitHub();
    const pr = this.pullRequests.find((p) => p.number === number);
    if (!pr) throw new Error(`PR #${number} not found.`);
    const choice = await vscode.window.showWarningMessage(
      `Close PR #${number} without merging?`,
      { modal: true, detail: `${pr.title}\n\nYou can reopen it on GitHub. Deleting the remote branch leaves your local bookmark “${pr.headRefName}” alone.` },
      "Close",
      "Close and delete remote branch",
    );
    if (!choice) return false;
    this.busy(`Closing PR #${number}…`);
    await github.close(number, choice !== "Close");
    this.prsFetchedAt = 0;
    return true;
  }

  /** Keeps one commit of a divergent change and abandons the others. */
  private async resolveDivergence(id: string) {
    const rev = this.findRevision(id);
    const change = rev?.divergentChangeId ?? id;
    const commits = await this.repo.commitsOfChange(change);
    if (commits.length < 2) {
      void vscode.window.showInformationMessage("That change is no longer divergent.");
      return true;
    }
    const items = commits.map((c) => ({
      label: `$(git-commit) ${c.commitShort}`,
      description: firstLine(c.description) || "(no description set)",
      detail: [
        c.isWorkingCopy && "working copy",
        c.localBookmarks.length > 0 && `bookmarks: ${c.localBookmarks.map((b) => b.name).join(", ")}`,
        c.empty && "empty",
        c.conflict && "conflicted",
        `by ${c.authorName || c.authorEmail}`,
      ]
        .filter(Boolean)
        .join(" · "),
      commit: c,
    }));
    const keep = await vscode.window.showQuickPick(items, {
      title: `${change.slice(0, 8)} is divergent: pick the version to keep (the others are abandoned)`,
      matchOnDescription: true,
    });
    if (!keep) return false;
    const others = commits.filter((c) => c.commitId !== keep.commit.commitId);
    const ok = await this.confirm(
      `Keep ${keep.commit.commitShort} and abandon ${others.length === 1 ? others[0].commitShort : `${others.length} other versions`}?`,
      "Descendants of the abandoned versions are rebased onto their parents. Check each version first with Show evolution log. You can undo this.",
      "Keep this version",
    );
    if (!ok) return false;
    await this.repo.abandon(others.map((c) => c.commitId));
    return true;
  }

  private async cleanUpMergedPr(number: number) {
    const pr = this.pullRequests.find((p) => p.number === number);
    if (!pr) throw new Error(`PR #${number} not found.`);
    const name = pr.headRefName;
    const ok = await this.confirm(
      `Clean up after PR #${number}?`,
      `1. Fetch from origin.\n2. Rebase revisions built on top of “${name}” onto trunk.\n3. Abandon “${name}”'s revisions that aren't in trunk (they were merged).\n4. Delete bookmark “${name}”.\n\nYou can undo this from the operation log.`,
      "Clean up",
    );
    if (!ok) return false;
    this.busy("Fetching…");
    await this.repo.fetch();
    this.busy("Cleaning up…");
    const { rebased, abandoned } = await this.repo.cleanUpMergedBookmark(name);
    vscode.window.setStatusBarMessage(`Cleaned up #${number}: rebased ${rebased}, abandoned ${abandoned}.`, 4000);
    this.prsFetchedAt = 0;
    return true;
  }

  async createPullRequest(req: CreatePrRequest): Promise<boolean> {
    if (!this.github) throw new Error("Pull requests need a GitHub remote and the gh CLI.");
    try {
      if (req.createHead) await this.repo.createBookmark(req.head, req.changeId);
      this.busy(`Pushing ${req.head}…`);
      await this.repo.push({ bookmarks: [req.head] });
      this.busy("Creating pull request…");
      const url = await this.github.createPullRequest(req);
      this.prsFetchedAt = 0;
      void vscode.window.showInformationMessage(`Created pull request ${url}`, "Open").then((c) => {
        if (c) void vscode.env.openExternal(vscode.Uri.parse(url));
      });
      return true;
    } catch (e) {
      this.reportError({ kind: "openCreatePullRequest", changeId: req.changeId }, e);
      return false;
    } finally {
      this.busyEmitter.fire({ busy: false });
      await this.refresh();
    }
  }
}
