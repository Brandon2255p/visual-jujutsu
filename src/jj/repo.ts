import type { Bookmark, ChangedFile, FileStatus, RemoteBookmark, Revision } from "../shared/types";
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
  }) + ` ++ "\\n"`;

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
  /** Set by version(); assume the newest jj until then. */
  private versionParts = [Infinity, 0, 0];

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
    // --onto/-o replaced --destination/-d in jj 0.36.
    const where = target === "o" && !this.atLeast("0.36.0") ? "-d" : `-${target}`;
    const args = ["rebase", `-${source}`, changeId, where, destination];
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
    // Before jj 0.42, pushing a bookmark the remote doesn't have yet needs --allow-new (deprecated in 0.36, removed in 0.42).
    if (args.bookmarks?.length && !this.atLeast("0.42.0")) a.push("--allow-new");
    if (args.dryRun) a.push("--dry-run");
    return this.run(a);
  }

  undo() {
    return this.run(["undo"]);
  }

  redo() {
    if (!this.atLeast("0.33.0")) return Promise.reject(new Error("Redo needs jj 0.33 or later. Use Undo, or the operation log."));
    return this.run(["redo"]);
  }
}
