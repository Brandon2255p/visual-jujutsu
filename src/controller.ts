import * as vscode from "vscode";
import { CommandError } from "./jj/cli";
import { JjRepo } from "./jj/repo";
import { GitHub } from "./github/gh";
import { layoutGraph } from "./shared/graph";
import type { Action, CreatePrDialogData, CreatePrRequest, RebaseDialogData } from "./shared/protocol";
import type { ChangedFile, GraphState, PullRequest, Revision, RevsetPreset } from "./shared/types";
import { shortChangeId } from "./shared/types";

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
      const [revisions, lastOperation] = await Promise.all([
        this.repo.log(this.revset, config().get<number>("logLimit", 200)),
        this.repo.lastOperation(),
      ]);
      this.revisions = revisions.filter((r) => !r.root);
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
      jjVersion: this.jjVersion,
      revset: this.revset,
      presets: this.presets(),
      revisions: this.revisions,
      layout: layoutGraph(this.revisions),
      pullRequests: this.pullRequests,
      lastOperation,
      error,
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
    this.busy("Pushing…");
    if (picks.some((p) => p.value === null)) await this.repo.push();
    else await this.repo.push({ bookmarks: picks.map((p) => p.value!) });
    this.prsFetchedAt = 0;
    return true;
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
    const uri = (revset: string) =>
      vscode.Uri.from({ scheme: "jj-rev", path: "/" + path, query: new URLSearchParams({ rev: revset }).toString() });
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

  createPrDialogData(changeId: string): CreatePrDialogData | null {
    const revision = this.findRevision(changeId);
    if (!revision) return null;
    const byCommit = new Map(this.revisions.map((r) => [r.commitId, r]));
    const prFor = (name: string) => this.pullRequests.find((p) => p.headRefName === name && p.state === "OPEN") ?? null;

    // Walk first parents down to trunk to find the stack below this revision.
    const stack: CreatePrDialogData["stack"] = [];
    let cur: Revision | undefined = revision;
    while (cur && !cur.immutable && !cur.inTrunk && stack.length < 20) {
      const bookmark = cur.localBookmarks[0]?.name ?? null;
      stack.push({ revision: cur, bookmark, pr: bookmark ? prFor(bookmark) : null });
      cur = byCommit.get(cur.parents[0]);
    }
    if (cur) stack.push({ revision: cur, bookmark: cur.localBookmarks[0]?.name ?? null, pr: null });

    const trunkName = this.revisions.find((r) => r.inTrunk && r.localBookmarks.length)?.localBookmarks[0].name ?? "main";
    const below = stack.slice(1).find((s) => s.bookmark && s.pr);
    const prefix = config().get<string>("pullRequestBookmarkPrefix", "push-");
    const existing = revision.localBookmarks.map((b) => b.name);
    const newName = `${prefix}${revision.changeId.slice(0, 12)}`;
    const baseOptions = [...new Set([trunkName, ...stack.slice(1).flatMap((s) => (s.bookmark ? [s.bookmark] : []))])];
    return {
      revision,
      headOptions: [...existing, newName],
      suggestedHead: existing[0] ?? newName,
      baseOptions,
      suggestedBase: below?.bookmark ?? trunkName,
      baseReason: below
        ? `The revision below has PR #${below.pr!.number}, so this PR stacks on it. Pick ${trunkName} to target trunk.`
        : `Targets ${trunkName}.`,
      stack,
    };
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
