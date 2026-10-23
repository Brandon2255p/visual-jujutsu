import type { Bookmark, ChangedFile, FileStatus, RemoteBookmark, Revision } from "../shared/types";
import type { NewMode, RebaseSource, RebaseTarget } from "../shared/protocol";
import { CommandLog, Runner } from "./cli";

/** One JSON object per revision; parsed by parseLogLine. */
export const LOG_TEMPLATE = `json({
  "change_id" => change_id,
  "commit_id" => commit_id,
  "short" => change_id.shortest(8),
  "commit_short" => commit_id.short(8),
  "description" => description,
  "author" => author,
  "parents" => parents.map(|p| p.commit_id()),
  "local_bookmarks" => local_bookmarks,
  "remote_bookmarks" => remote_bookmarks,
  "tags" => tags,
  "wc" => current_working_copy,
  "immutable" => immutable,
  "empty" => empty,
  "conflict" => conflict,
  "divergent" => divergent,
  "mine" => mine,
  "root" => root,
  "trunk" => self.contained_in("trunk()"),
}) ++ "\\n"`;

const FILES_TEMPLATE = `self.diff().files().map(|f| json({
  "path" => f.path().display(),
  "status" => f.status(),
  "conflict" => f.target().conflict(),
})).join("\\n") ++ "\\n---\\n" ++ self.diff().stat().files().map(|f| json({
  "path" => f.path().display(),
  "added" => f.lines_added(),
  "removed" => f.lines_removed(),
})).join("\\n")`;

const OP_TEMPLATE = `json({
  "id" => self.id().short(),
  "description" => self.description(),
  "time" => self.time().end(),
}) ++ "\\n"`;

interface RawRef {
  name: string;
  remote?: string;
  target: (string | null)[];
}

export function parseLogLine(line: string): Revision {
  const j = JSON.parse(line);
  const targets = (r: RawRef) => r.target.filter((t): t is string => t !== null);
  return {
    changeId: j.change_id,
    commitId: j.commit_id,
    short: j.short,
    commitShort: j.commit_short,
    description: j.description,
    authorName: j.author.name,
    authorEmail: j.author.email,
    timestamp: j.author.timestamp,
    parents: j.parents,
    localBookmarks: (j.local_bookmarks as RawRef[]).map((b): Bookmark => ({ name: b.name, targets: targets(b) })),
    remoteBookmarks: (j.remote_bookmarks as RawRef[])
      .filter((b) => b.remote !== "git")
      .map((b): RemoteBookmark => ({ name: b.name, remote: b.remote ?? "", targets: targets(b) })),
    tags: (j.tags as RawRef[]).map((t) => t.name),
    isWorkingCopy: j.wc,
    immutable: j.immutable,
    empty: j.empty,
    conflict: j.conflict,
    divergent: j.divergent,
    mine: j.mine,
    root: j.root,
    inTrunk: j.trunk,
  };
}

export function parseFiles(output: string): ChangedFile[] {
  const [statusPart, statPart = ""] = output.split("\n---\n");
  const stats = new Map<string, { added: number; removed: number }>();
  for (const line of statPart.split("\n")) {
    if (!line.trim()) continue;
    const s = JSON.parse(line);
    stats.set(s.path, { added: s.added, removed: s.removed });
  }
  const files: ChangedFile[] = [];
  for (const line of statusPart.split("\n")) {
    if (!line.trim()) continue;
    const f = JSON.parse(line);
    const st = stats.get(f.path) ?? { added: 0, removed: 0 };
    files.push({ path: f.path, status: f.status as FileStatus, conflict: f.conflict, ...st });
  }
  return files;
}

export class JjRepo {
  private readonly runner: Runner;

  constructor(
    jjPath: () => string,
    readonly root: string,
    log: CommandLog,
  ) {
    // An editor would hang the extension, so make any editor launch fail fast.
    this.runner = new Runner(jjPath, root, log, ["--color=never"], { JJ_EDITOR: "false" });
  }

  static async findRoot(jjPath: string, dir: string): Promise<string | null> {
    const runner = new Runner(() => jjPath, dir, { append: () => undefined });
    try {
      return (await runner.run(["root"], { quiet: true })).trim();
    } catch {
      return null;
    }
  }

  run(args: string[], quiet = false) {
    return this.runner.run(args, { quiet });
  }

  async version(): Promise<string> {
    return (await this.run(["--version"], true)).trim().replace(/^jj\s+/, "");
  }

  async log(revset: string, limit: number): Promise<Revision[]> {
    const args = ["log", "--no-graph", "-T", LOG_TEMPLATE, "-n", String(limit)];
    if (revset.trim()) args.push("-r", revset);
    const out = await this.run(args, true);
    return out
      .split("\n")
      .filter((l) => l.trim())
      .map(parseLogLine);
  }

  async files(changeId: string): Promise<ChangedFile[]> {
    const out = await this.run(["log", "--no-graph", "-r", changeId, "-T", FILES_TEMPLATE], true);
    return parseFiles(out);
  }

  async fileContent(changeId: string, path: string): Promise<string> {
    return this.run(["file", "show", "-r", changeId, "--", `root-file:${JSON.stringify(path)}`], true);
  }

  async lastOperation(): Promise<{ id: string; description: string; time: string } | null> {
    const out = await this.run(["op", "log", "-n", "1", "--no-graph", "-T", OP_TEMPLATE], true);
    const line = out.split("\n").find((l) => l.trim());
    return line ? JSON.parse(line) : null;
  }

  async remotes(): Promise<{ name: string; url: string }[]> {
    const out = await this.run(["git", "remote", "list"], true);
    return out
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const [name, url] = l.split(/\s+/);
        return { name, url };
      });
  }

  describe(changeId: string, message: string) {
    return this.run(["describe", "-r", changeId, "-m", message]);
  }

  edit(changeId: string) {
    return this.run(["edit", changeId]);
  }

  newRevision(changeIds: string[], mode: NewMode) {
    if (mode === "onto") return this.run(["new", ...changeIds]);
    const flag = mode === "after" ? "--insert-after" : "--insert-before";
    return this.run(["new", ...changeIds.flatMap((id) => [flag, id])]);
  }

  abandon(changeIds: string[]) {
    return this.run(["abandon", ...changeIds]);
  }

  squash(from: string, into: string, message: string) {
    return this.run(["squash", "--from", from, "--into", into, "-m", message]);
  }

  /** Moves whole files; the destination keeps its description. */
  moveFiles(from: string, into: string, paths: string[]) {
    return this.run([
      "squash",
      "--from",
      from,
      "--into",
      into,
      "--use-destination-message",
      "--",
      ...paths.map((p) => `root-file:${JSON.stringify(p)}`),
    ]);
  }

  rebase(source: RebaseSource, changeId: string, target: RebaseTarget, destination: string, skipEmptied = false) {
    const args = ["rebase", `-${source}`, changeId, `-${target}`, destination];
    if (skipEmptied) args.push("--skip-emptied");
    return this.run(args);
  }

  createBookmark(name: string, changeId: string) {
    return this.run(["bookmark", "create", name, "-r", changeId]);
  }

  setBookmark(name: string, changeId: string, allowBackwards: boolean) {
    const args = ["bookmark", "set", name, "-r", changeId];
    if (allowBackwards) args.push("--allow-backwards");
    return this.run(args);
  }

  async bookmarkNames(): Promise<string[]> {
    const out = await this.run(["bookmark", "list", "-T", 'name ++ "\\n"'], true);
    return [...new Set(out.split("\n").filter((l) => l.trim()))];
  }

  fetch() {
    return this.run(["git", "fetch"]);
  }

  push(args: { bookmarks?: string[]; changes?: string[]; dryRun?: boolean } = {}) {
    const a = ["git", "push"];
    for (const b of args.bookmarks ?? []) a.push("-b", b);
    for (const c of args.changes ?? []) a.push("-c", c);
    if (args.dryRun) a.push("--dry-run");
    return this.run(a);
  }

  undo() {
    return this.run(["undo"]);
  }

  redo() {
    return this.run(["redo"]);
  }
}
