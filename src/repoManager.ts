import * as vscode from "vscode";
import { realpathSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { JjRepo } from "./jj/repo";
import { GitHub, githubSlug } from "./github/gh";
import { Controller } from "./controller";
import { JjSourceControl } from "./views/scm";
import type { CommandLog } from "./jj/cli";
import type { RepoInfo } from "./shared/types";

export interface RepoEntry {
  root: string;
  name: string;
  repo: JjRepo;
  controller: Controller;
  scm: JjSourceControl;
}

function config() {
  return vscode.workspace.getConfiguration("visualJujutsu");
}

const ACTIVE_KEY = "visualJujutsu.activeRepo";

/**
 * jj reports the root with symlinks resolved (/var → /private/var on macOS).
 * Express it through the folder as VS Code opened it, so file URIs match.
 */
function asOpened(root: string, folder: string): string {
  try {
    const real = realpathSync(folder);
    if (real === root || real.startsWith(root + sep)) return resolve(folder, relative(real, root));
  } catch {
    // Fall back to jj's path.
  }
  return root;
}

/**
 * Every jj repo in the workspace (one per folder, plus nested repos), each with
 * its own controller and Source Control entry. The graph shows the active one.
 */
export class RepoManager implements vscode.Disposable {
  private readonly entries = new Map<string, RepoEntry>();
  private readonly disposables: vscode.Disposable[] = [];
  private activeRoot: string | undefined;
  private readonly activeEmitter = new vscode.EventEmitter<RepoEntry>();
  readonly onDidChangeActive = this.activeEmitter.event;
  private readonly listEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeRepos = this.listEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly log: CommandLog,
  ) {
    this.activeRoot = context.workspaceState.get<string>(ACTIVE_KEY);
    this.disposables.push(
      this.activeEmitter,
      this.listEmitter,
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.discover()),
      vscode.window.onDidChangeWindowState((s) => {
        if (s.focused) this.refreshAll(300);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("visualJujutsu")) this.refreshAll(0);
      }),
    );
  }

  dispose() {
    for (const e of this.entries.values()) e.controller.dispose();
    this.disposables.forEach((d) => d.dispose());
  }

  get active(): RepoEntry | undefined {
    return (this.activeRoot && this.entries.get(this.activeRoot)) || this.entries.values().next().value;
  }

  list(): RepoInfo[] {
    return [...this.entries.values()].map((e) => ({ root: e.root, name: e.name }));
  }

  get(root: string | null | undefined): RepoEntry | undefined {
    return root ? this.entries.get(root) : this.active;
  }

  setActive(root: string) {
    const entry = this.entries.get(root);
    if (!entry || root === this.active?.root) return;
    this.activeRoot = root;
    void this.context.workspaceState.update(ACTIVE_KEY, root);
    this.activeEmitter.fire(entry);
    void entry.controller.refresh();
  }

  /** Finds jj repos in the workspace and sets up any new ones. Returns how many there are. */
  async discover(): Promise<number> {
    const jjPath = config().get<string>("jjPath", "jj");
    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = await JjRepo.findRoot(jjPath, folder.uri.fsPath);
      if (root) roots.add(asOpened(root, folder.uri.fsPath));
    }
    // Nested repos: <root>/.jj/working_copy/checkout
    const nested = await vscode.workspace.findFiles("**/.jj/working_copy/checkout", "**/node_modules/**", 50);
    for (const file of nested) roots.add(dirname(dirname(dirname(file.fsPath))));

    let added = false;
    for (const root of roots) {
      if (this.entries.has(root)) continue;
      this.entries.set(root, await this.create(root, this.nameFor(root, roots)));
      added = true;
    }
    if (added) {
      this.listEmitter.fire();
      const active = this.active;
      if (active) this.activeEmitter.fire(active);
    }
    return this.entries.size;
  }

  private nameFor(root: string, roots: Set<string>) {
    const name = basename(root);
    const clash = [...roots].some((r) => r !== root && basename(r) === name);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return clash && folder ? relative(folder, root) || name : name;
  }

  private async create(root: string, name: string): Promise<RepoEntry> {
    const repo = new JjRepo(() => config().get<string>("jjPath", "jj"), root, this.log);
    const controller = new Controller(repo, await this.github(repo, root), this.output, name);
    const scm = new JjSourceControl(controller);
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, ".jj/repo/op_heads/heads/*"));
    let timer: NodeJS.Timeout | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void controller.refresh(), ms);
    };
    this.disposables.push(
      scm,
      watcher,
      watcher.onDidCreate(() => schedule(150)),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.fsPath.startsWith(root + "/")) schedule(800);
      }),
      { dispose: () => clearTimeout(timer) },
    );
    void controller.refresh();
    return { root, name, repo, controller, scm };
  }

  private refreshAll(ms: number) {
    setTimeout(() => {
      for (const e of this.entries.values()) void e.controller.refresh();
    }, ms);
  }

  private async github(repo: JjRepo, root: string) {
    try {
      const remotes = await repo.remotes();
      const remote = remotes.find((r) => r.name === "origin" && githubSlug(r.url)) ?? remotes.find((r) => githubSlug(r.url));
      const slug = remote && githubSlug(remote.url);
      return slug ? new GitHub(() => config().get<string>("ghPath", "gh"), root, this.log, slug) : null;
    } catch {
      return null;
    }
  }
}
