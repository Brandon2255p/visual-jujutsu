import type { Bookmark, ChangedFile, EvologEntry, FileStatus, Operation, RemoteBookmark, RemoteBookmarkRef, Revision } from "../shared/types";
import type { NewMode, RebaseSource, RebaseTarget } from "../shared/protocol";
import { CommandLog, Runner } from "./cli";

// Templates build JSON by string concatenation rather than json({ ... }), because
// map literals need jj 0.46 and many users run older versions. Everything here
// works on jj 0.27+ (stringify/escape_json); see MIN_JJ_VERSION.
const str = (expr: string) => `stringify(${expr}).escape_json()`;
const bool = (expr: string) => `if(${expr}, "true", "false")`;
const list = (expr: string, item: string) => `"[" ++ ${expr}.map(|x| ${item}).join(",") ++ "]"`;
const obj = (fields: Record<string, string>) =>
  `"{" ++ ${Object.entries(fields)
    .map(([key, value]) => `"\\"${key}\\":" ++ ${value}`)
    .join(` ++ "," ++ `)} ++ "}"`;
const TIME_FORMAT = `"%Y-%m-%dT%H:%M:%S%:z"`;

// Only remote refs read .remote(): on local refs it is empty or an error, depending on the jj version.
const LOCAL_REF = obj({
  name: str("x.name()"),
  target: list("x.added_targets()", str("x.commit_id()")),
});
const REMOTE_REF = obj({
  name: str("x.name()"),
  remote: str("x.remote()"),
  target: list("x.added_targets()", str("x.commit_id()")),
});

/** One JSON object per revision; parsed by parseLogLine. */
export const LOG_TEMPLATE =
  obj({
    change_id: str("change_id"),
    commit_id: str("commit_id"),
    short: obj({ prefix: str("change_id.shortest(8).prefix()"), rest: str("change_id.shortest(8).rest()") }),
    commit_short: str("commit_id.short(8)"),
    description: str("description"),
    author: obj({
      name: str("author.name()"),
      email: str("author.email()"),
      timestamp: str(`author.timestamp().format(${TIME_FORMAT})`),
    }),
    parents: list("parents", str("x.commit_id()")),
    local_bookmarks: list("local_bookmarks", LOCAL_REF),
    remote_bookmarks: list("remote_bookmarks", REMOTE_REF),
    tags: list("tags", LOCAL_REF),
    wc: bool("current_working_copy"),
    immutable: bool("immutable"),
    empty: bool("empty"),
    conflict: bool("conflict"),
    divergent: bool("divergent"),
    mine: bool("mine"),
    root: bool("root"),
    trunk: bool(`self.contained_in("trunk()")`),
  }) + ` ++ "\\n"`;

const FILE_STATUS_TEMPLATE = `self.diff().files().map(|f| ${obj({
  path: str("f.path().display()"),
  status: str("f.status()"),
  conflict: bool("f.target().conflict()"),
})}).join("\\n")`;

/** Per-file line counts in templates need jj 0.36 (DiffStats.files()). */
const FILE_STATS_TEMPLATE = `self.diff().stat().files().map(|f| ${obj({
  path: str("f.path().display()"),
  added: `f.lines_added()`,
  removed: `f.lines_removed()`,
})}).join("\\n")`;

const FILES_TEMPLATE = `${FILE_STATUS_TEMPLATE} ++ "\\n---\\n" ++ ${FILE_STATS_TEMPLATE}`;

const OP_TEMPLATE =
  obj({
    id: str("self.id().short()"),
    description: str("self.description()"),
    time: str(`self.time().end().format(${TIME_FORMAT})`),
    user: str("self.user()"),
    current: bool("self.current_operation()"),
  }) + ` ++ "\\n"`;

/** Evolution log entries. Newer jj (0.36 in testing) gives each entry a commit and an operation; older jj gives the commit itself. */
const evologTemplate = (commit: string, operation: string) =>
  obj({
    commit_id: str(`${commit}commit_id()`),
    commit_short: str(`${commit}commit_id().short(8)`),
    description: str(`${commit}description()`),
    time: str(`${commit}committer().timestamp().format(${TIME_FORMAT})`),
    operation,
    empty: bool(`${commit}empty()`),
    conflict: bool(`${commit}conflict()`),
  }) + ` ++ "\n"`;
const EVOLOG_TEMPLATE = evologTemplate("commit.", `if(operation, ${str("operation.description()")}, "null")`);
const EVOLOG_TEMPLATE_OLD = evologTemplate("self.", `"null"`);

// `present` skips placeholders: from jj 0.36, new local bookmarks are tracked
// on the remote before they exist there.
const REMOTE_BOOKMARK_TEMPLATE = `if(remote, if(present, ${obj({
  name: str("name"),
  remote: str("remote"),
  tracked: bool("tracked"),
})} ++ "\\n"))`;

export const MIN_JJ_VERSION = "0.27.0";

/** Parses "0.45.0-8da2b7b…" (or "jj 0.45.0") into comparable numbers. */
export function parseVersion(text: string): number[] {
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

export function versionAtLeast(have: number[], want: string): boolean {
  const w = parseVersion(want);
  for (let i = 0; i < 3; i++) if (have[i] !== w[i]) return have[i] > w[i];
  return true;
}

/** Line counts per file from `jj diff --git` output (fallback for jj < 0.36). */
export function parseGitDiffCounts(diff: string): Map<string, { added: number; removed: number }> {
  const counts = new Map<string, { added: number; removed: number }>();
  let current: { added: number; removed: number } | null = null;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const header = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    if (header) {
      current = { added: 0, removed: 0 };
      counts.set(header[2], current);
      inHunk = false;
    } else if (line.startsWith("@@")) inHunk = true;
    else if (current && inHunk && line.startsWith("+")) current.added++;
    else if (current && inHunk && line.startsWith("-")) current.removed++;
  }
  return counts;
}

interface RawRef {
  name: string;
  remote?: string;
  target: (string | null)[];
}

/** File statuses and line counts from `jj diff --git` output. */
export function parseGitDiffFiles(diff: string): ChangedFile[] {
  const counts = parseGitDiffCounts(diff);
  const files: ChangedFile[] = [];
  let current: ChangedFile | null = null;
  for (const line of diff.split("\n")) {
    const header = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    if (header) {
      current = { path: header[2], status: "modified", conflict: false, ...counts.get(header[2])! };
      files.push(current);
    } else if (current && line.startsWith("new file mode")) current.status = "added";
    else if (current && line.startsWith("deleted file mode")) current.status = "removed";
  }
  return files;
}

export function parseLogLine(line: string): Revision {
  const j = JSON.parse(line);
  const targets = (r: RawRef) => r.target.filter((t): t is string => t !== null);
  return {
    changeId: j.divergent ? j.commit_id : j.change_id,
    ...(j.divergent ? { divergentChangeId: j.change_id } : {}),
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
  /** Set by version(); assume the newest jj until then. */
  private versionParts = [Infinity, 0, 0];
  /** Set once jj rejects the newer evolog template (commit + operation). */
  private evologOld = false;

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
    const version = (await this.run(["--version"], true)).trim().replace(/^jj\s+/, "");
    this.versionParts = parseVersion(version);
    return version;
  }

  atLeast(version: string) {
    return versionAtLeast(this.versionParts, version);
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
    if (this.atLeast("0.36.0")) {
      return parseFiles(await this.run(["log", "--no-graph", "-r", changeId, "-T", FILES_TEMPLATE], true));
    }
    const [status, diff] = await Promise.all([
      this.run(["log", "--no-graph", "-r", changeId, "-T", FILE_STATUS_TEMPLATE], true),
      this.run(["diff", "-r", changeId, "--git"], true),
    ]);
    const counts = parseGitDiffCounts(diff);
    return parseFiles(status).map((f) => ({ ...f, ...(counts.get(f.path) ?? { added: 0, removed: 0 }) }));
  }

  async fileContent(changeId: string, path: string): Promise<string> {
    return this.run(["file", "show", "-r", changeId, "--", `root-file:${JSON.stringify(path)}`], true);
  }

  async lastOperation(): Promise<Operation | null> {
    return (await this.operations(1))[0] ?? null;
  }

  async operations(limit: number): Promise<Operation[]> {
    const out = await this.run(["op", "log", "-n", String(limit), "--no-graph", "-T", OP_TEMPLATE], true);
    return out
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }

  restoreOperation(id: string) {
    return this.run(["op", "restore", id]);
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

  /** A revset for several revisions; jj before 0.32 needs `all:` when it can match more than one. */
  private many(ids: string[]) {
    const set = ids.join(" | ");
    return ids.length > 1 && !this.atLeast("0.32.0") ? `all:${set}` : set;
  }

  private fileset(paths: string[]) {
    return paths.map((p) => `root-file:${JSON.stringify(p)}`);
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

  duplicate(changeId: string) {
    return this.run(["duplicate", changeId]);
  }

  /** Every version of a change, newest first. */
  async evolog(changeId: string): Promise<EvologEntry[]> {
    const read = (template: string) => this.run(["evolog", "-r", changeId, "--no-graph", "-T", template], true);
    let out: string;
    try {
      out = await read(this.evologOld ? EVOLOG_TEMPLATE_OLD : EVOLOG_TEMPLATE);
    } catch (e) {
      if (this.evologOld || !/Failed to parse template/.test(String(e))) throw e;
      this.evologOld = true;
      out = await read(EVOLOG_TEMPLATE_OLD);
    }
    // Some versions (e.g. 0.31) add their own "-- operation …" lines; keep only ours.
    return out
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => {
        const j = JSON.parse(l);
        return { commitId: j.commit_id, commitShort: j.commit_short, description: j.description, time: j.time, operation: j.operation, empty: j.empty, conflict: j.conflict };
      });
  }
  /** Files that differ between two commits (e.g. two versions of a change). */
  async diffBetween(from: string, to: string): Promise<ChangedFile[]> {
    return parseGitDiffFiles(await this.run(["diff", "--from", from, "--to", to, "--git"], true));
  }

  /** Replaces a revision's contents with another commit's (e.g. an earlier version of it). */
  restoreFrom(from: string, into: string) {
    return this.run(["restore", "--from", from, "--into", into]);
  }

  /** Every visible commit of a change; more than one when it is divergent. */
  async commitsOfChange(changeId: string): Promise<Revision[]> {
    // change_id() arrived in jj 0.31; before that a divergent change ID lists all its commits.
    return this.log(this.atLeast("0.31.0") ? `change_id(${changeId})` : changeId, 20);
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
      ...this.fileset(paths),
    ]);
  }

  /** Squashes several revisions into one, with an explicit message so no editor opens. */
  squashMany(from: string[], into: string, message: string) {
    return this.run(["squash", "--from", this.many(from), "--into", into, "-m", message]);
  }

  /**
   * Moves the given files out of a revision into a new revision just before it.
   * Both keep the original description; `JJ_EDITOR=true` accepts it unchanged
   * (`split --message` only exists from jj 0.30).
   */
  split(changeId: string, paths: string[]) {
    return this.runner.run(["split", "-r", changeId, "--", ...this.fileset(paths)], { env: { JJ_EDITOR: "true" } });
  }

  /** Moves each change in a revision into the mutable ancestor that last touched those lines. */
  absorb(from: string) {
    return this.run(["absorb", "--from", from]);
  }

  /** Discards a revision's changes to the given files (back to the parent's version). */
  restoreFiles(changeId: string, paths: string[]) {
    return this.run(["restore", "--from", `${changeId}-`, "--into", changeId, "--", ...this.fileset(paths)]);
  }

  /** --onto/-o replaced --destination/-d in jj 0.36. */
  private targetFlag(target: RebaseTarget) {
    return target === "o" && !this.atLeast("0.36.0") ? "-d" : `-${target}`;
  }

  rebase(source: RebaseSource, changeId: string, target: RebaseTarget, destination: string, skipEmptied = false) {
    const args = ["rebase", `-${source}`, changeId, this.targetFlag(target), destination];
    if (skipEmptied) args.push("--skip-emptied");
    return this.run(args);
  }

  /**
   * Shows what a rebase would do without keeping it: runs it (leaving the
   * working copy alone), reads the graph, then restores the operation it
   * started from and abandons the rebase operation. jj can't abandon the
   * current operation, so a "restore" operation remains; undoing it is a
   * no-op. Nothing else runs in between, so a refresh never sees the rebase.
   */
  previewRebase(source: RebaseSource, changeId: string, target: RebaseTarget, destination: string, skipEmptied = false) {
    const revset = `trunk() | (trunk()..(${changeId}:: | ${destination})) | ${destination}`;
    return this.runner.exclusive(async (run) => {
      const q = (args: string[], ignoreWc = true) => run(ignoreWc ? ["--ignore-working-copy", ...args] : args, { quiet: true });
      const read = async () =>
        (await q(["log", "--no-graph", "-T", LOG_TEMPLATE, "-n", "60", "-r", revset])).split("\n").filter((l) => l.trim()).map(parseLogLine);
      // Snapshot the working copy first, so the operation we return to includes it.
      await q(["log", "--no-graph", "-r", "@", "-T", "''"], false);
      const opId = (await q(["op", "log", "-n", "1", "--no-graph", "-T", "self.id()"])).trim();
      const before = await read();
      const args = ["rebase", `-${source}`, changeId, this.targetFlag(target), destination];
      if (skipEmptied) args.push("--skip-emptied");
      await q(args);
      try {
        return { before, after: await read() };
      } finally {
        await q(["op", "restore", opId]);
        await q(["op", "abandon", `${opId}..@-`]);
      }
    });
  }

  /** Rebases several revisions (or several roots with their descendants) at once. */
  rebaseMany(source: "r" | "s", changeIds: string[], target: RebaseTarget, destination: string) {
    return this.run(["rebase", `-${source}`, this.many(changeIds), this.targetFlag(target), destination]);
  }

  /** Rebases every stack of your mutable revisions onto trunk. */
  rebaseAllOnTrunk() {
    const roots = "roots(mutable() & mine() ~ ::trunk())";
    return this.run(["rebase", "-s", this.atLeast("0.32.0") ? roots : `all:${roots}`, this.targetFlag("o"), "trunk()"]);
  }

  createBookmark(name: string, changeId: string) {
    return this.run(["bookmark", "create", name, "-r", changeId]);
  }

  setBookmark(name: string, changeId: string, allowBackwards: boolean) {
    const args = ["bookmark", "set", name, "-r", changeId];
    if (allowBackwards) args.push("--allow-backwards");
    return this.run(args);
  }

  /** Change IDs of the revisions in a revset. */
  async changeIds(revset: string, limit = 500): Promise<string[]> {
    const out = await this.run(["log", "--no-graph", "-r", revset, "-n", String(limit), "-T", 'change_id ++ "\\n"'], true);
    return out.split("\n").filter((l) => l.trim());
  }

  /**
   * After a bookmark's PR is merged: rebases the revisions built on top of it
   * onto trunk, abandons its revisions that didn't land in trunk as-is (e.g. a
   * squash merge), and deletes the bookmark. Fetch first.
   */
  async cleanUpMergedBookmark(name: string): Promise<{ rebased: number; abandoned: number }> {
    const b = `bookmarks(exact:${JSON.stringify(name)})`;
    const above = await this.changeIds(`children(${b}) & mutable()`);
    const merged = await this.changeIds(`(::${b} ~ ::trunk()) & mutable()`);
    if (above.length) await this.rebaseMany("s", above, "o", "trunk()");
    if (merged.length) await this.abandon(merged);
    if ((await this.bookmarkNames()).includes(name)) await this.deleteBookmarks([name]);
    return { rebased: above.length, abandoned: merged.length };
  }

  renameBookmark(oldName: string, newName: string) {
    return this.run(["bookmark", "rename", oldName, newName]);
  }

  /** Deletes local bookmarks; the deletion reaches the remote on the next push. */
  deleteBookmarks(names: string[]) {
    return this.run(["bookmark", "delete", ...names]);
  }

  /** Forgets bookmarks locally without deleting them on the remote. */
  forgetBookmarks(names: string[]) {
    return this.run(["bookmark", "forget", ...names]);
  }

  trackBookmark(name: string, remote: string) {
    return this.run(["bookmark", "track", `${name}@${remote}`]);
  }

  untrackBookmark(name: string, remote: string) {
    return this.run(["bookmark", "untrack", `${name}@${remote}`]);
  }

  async remoteBookmarks(): Promise<RemoteBookmarkRef[]> {
    const out = await this.run(["bookmark", "list", "--all-remotes", "-T", REMOTE_BOOKMARK_TEMPLATE], true);
    return out
      .split("\n")
      .filter((l) => l.trim())
      .map((l): RemoteBookmarkRef => JSON.parse(l))
      .filter((b) => b.remote !== "git");
  }

  async bookmarkNames(): Promise<string[]> {
    const out = await this.run(["bookmark", "list", "-T", 'name ++ "\\n"'], true);
    return [...new Set(out.split("\n").filter((l) => l.trim()))];
  }

  fetch() {
    return this.run(["git", "fetch"]);
  }

  /**
   * Pushes bookmarks (by name, or every bookmark in `revisions`) and changes.
   * With dryRun, resolves with jj's report of what would change.
   */
  async push(args: { bookmarks?: string[]; revisions?: string; changes?: string[]; dryRun?: boolean } = {}) {
    const a = ["git", "push"];
    for (const b of args.bookmarks ?? []) a.push("-b", b);
    if (args.revisions) a.push("-r", args.revisions);
    for (const c of args.changes ?? []) a.push("-c", c);
    if (args.bookmarks?.length || args.revisions) {
      // Before jj 0.42, pushing a bookmark the remote doesn't have yet needs --allow-new (deprecated in 0.36, removed in 0.42).
      if (!this.atLeast("0.42.0")) a.push("--allow-new");
      else {
        const names = [...(args.bookmarks ?? [])];
        if (args.revisions) names.push(...(await this.log(args.revisions, 1000)).flatMap((r) => r.localBookmarks.map((b) => b.name)));
        await this.trackNewBookmarks(names);
      }
    }
    if (args.dryRun) a.push("--dry-run");
    return this.runner.run(a, { includeStderr: args.dryRun });
  }

  /**
   * From jj 0.42, jj refuses to push a bookmark the remote doesn't have until
   * it is tracked (unless remotes.<name>.auto-track-bookmarks covers it).
   */
  private async trackNewBookmarks(names: string[]) {
    if (!names.length) return;
    const remote = await this.pushRemote();
    const tracked = new Set((await this.remoteBookmarks()).filter((b) => b.remote === remote && b.tracked).map((b) => b.name));
    const missing = [...new Set(names)].filter((n) => !tracked.has(n));
    if (missing.length) await this.run(["bookmark", "track", ...missing.map((n) => `${n}@${remote}`)]);
  }

  /** The remote jj git push uses: git.push, else origin. */
  private async pushRemote() {
    try {
      return (await this.run(["config", "get", "git.push"], true)).trim() || "origin";
    } catch {
      return "origin";
    }
  }

  undo() {
    return this.run(["undo"]);
  }

  redo() {
    if (!this.atLeast("0.33.0")) return Promise.reject(new Error("Redo needs jj 0.33 or later. Use Undo, or the operation log."));
    return this.run(["redo"]);
  }
}
