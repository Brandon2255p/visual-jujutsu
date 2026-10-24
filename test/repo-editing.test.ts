import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JjRepo } from "../src/jj/repo";

// Integration tests for split, absorb, restore, bulk rebase/squash, bookmarks,
// stack push and the operation log. Set JJ_BIN to test another jj build.
const JJ = process.env.JJ_BIN ?? "jj";
let dir: string;
let remote: string;
let repo: JjRepo;

function jj(...args: string[]) {
  return execFileSync(JJ, ["--color=never", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const one = (revset: string, template = "change_id") => jj("log", "--no-graph", "-r", revset, "-T", template).trim();
const idOf = (desc: string) => one(`description(exact:"${desc}\n")`);
const paths = async (id: string) => (await repo.files(id)).map((f) => f.path).sort();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "vj-edit-"));
  remote = mkdtempSync(join(tmpdir(), "vj-edit-remote-"));
  execFileSync("git", ["init", "--bare", "-q", remote]);
  jj("git", "init", ".");
  jj("config", "set", "--repo", "user.name", "Test");
  jj("config", "set", "--repo", "user.email", "test@example.com");
  jj("git", "remote", "add", "origin", remote);
  writeFileSync(join(dir, "a.txt"), "a\n");
  jj("describe", "-m", "base");
  jj("bookmark", "create", "main", "-r", "@");
  jj("new", "-m", "one");
  writeFileSync(join(dir, "b.txt"), "b\n");
  writeFileSync(join(dir, "c.txt"), "c\n");
  jj("new", "-m", "two");
  writeFileSync(join(dir, "d.txt"), "line 1\nline 2\n");
  jj("new");
  repo = new JjRepo(() => JJ, dir, { append: () => undefined });
  await repo.version();
  await repo.push({ bookmarks: ["main"] });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

describe("editing revisions", () => {
  it("splits the selected files into their own revision", async () => {
    const id = idOf("one");
    await repo.split(id, ["c.txt"]);
    // jj keeps the selected files in the original change and moves the rest to a new child.
    expect(await paths(id)).toEqual(["c.txt"]);
    const rest = one(`children(${id})`);
    expect(await paths(rest)).toEqual(["b.txt"]);
    // Both halves keep the description; no editor was opened.
    expect(one(rest, "description").trim()).toBe("one");
    jj("describe", "-r", rest, "-m", "one rest");
  });

  it("absorbs working-copy changes into the revision that added the lines", async () => {
    writeFileSync(join(dir, "d.txt"), "line 1 changed\nline 2\n");
    await repo.absorb("@");
    expect(jj("file", "show", "-r", idOf("two"), "d.txt")).toBe("line 1 changed\nline 2\n");
    expect(one("@", 'if(empty, "empty", "not empty")')).toBe("empty");
  });

  it("restores a file to its parent's version", async () => {
    const two = idOf("two");
    await repo.restoreFiles(two, ["d.txt"]);
    expect(await paths(two)).toEqual([]);
  });

  it("squashes several revisions into one", async () => {
    jj("new", "main", "-m", "s1");
    writeFileSync(join(dir, "s1.txt"), "1\n");
    jj("new", "main", "-m", "s2");
    writeFileSync(join(dir, "s2.txt"), "2\n");
    jj("new", "main", "-m", "target");
    writeFileSync(join(dir, "t.txt"), "t\n");
    jj("new");
    await repo.squashMany([idOf("s1"), idOf("s2")], idOf("target"), "target with s1 and s2");
    expect(await paths(idOf("target with s1 and s2"))).toEqual(["s1.txt", "s2.txt", "t.txt"]);
  });

  it("rebases several revisions at once", async () => {
    jj("new", "main", "-m", "r1");
    jj("new", "main", "-m", "r2");
    const dest = idOf("target with s1 and s2");
    await repo.rebaseMany("r", [idOf("r1"), idOf("r2")], "o", dest);
    expect(one(`${idOf("r1")}-`)).toBe(dest);
    expect(one(`${idOf("r2")}-`)).toBe(dest);
  });

  it("rebases all stacks onto trunk", async () => {
    jj("new", "main", "-m", "new trunk");
    writeFileSync(join(dir, "trunk.txt"), "t\n");
    jj("bookmark", "set", "main", "-r", "@");
    await repo.push({ bookmarks: ["main"] });
    jj("new");
    await repo.rebaseAllOnTrunk();
    const trunk = idOf("new trunk");
    expect(one(`roots(${idOf("two")}::) & ${idOf("two")}`)).toBe(idOf("two"));
    expect(jj("log", "--no-graph", "-r", `::${idOf("two")}`, "-T", 'change_id ++ "\\n"')).toContain(trunk);
    expect(one(`${idOf("target with s1 and s2")}-`)).toBe(trunk);
  });
});

describe("bookmarks", () => {
  it("renames, deletes and forgets", async () => {
    jj("bookmark", "create", "feat", "-r", idOf("two"));
    await repo.renameBookmark("feat", "feat2");
    expect(await repo.bookmarkNames()).toContain("feat2");
    expect(await repo.bookmarkNames()).not.toContain("feat");
    await repo.deleteBookmarks(["feat2"]);
    expect(await repo.bookmarkNames()).not.toContain("feat2");
    jj("bookmark", "create", "scratch", "-r", idOf("two"));
    await repo.forgetBookmarks(["scratch"]);
    expect(await repo.bookmarkNames()).not.toContain("scratch");
  });

  it("lists, untracks and tracks remote bookmarks", async () => {
    expect(await repo.remoteBookmarks()).toContainEqual({ name: "main", remote: "origin", tracked: true });
    await repo.untrackBookmark("main", "origin");
    expect(await repo.remoteBookmarks()).toContainEqual({ name: "main", remote: "origin", tracked: false });
    await repo.trackBookmark("main", "origin");
    expect(await repo.remoteBookmarks()).toContainEqual({ name: "main", remote: "origin", tracked: true });
  });

  it("previews pushing every bookmark in a stack", async () => {
    jj("bookmark", "create", "stack-a", "-r", idOf("one"));
    jj("bookmark", "create", "stack-b", "-r", idOf("two"));
    const report = await repo.push({ revisions: `trunk()..${idOf("two")}`, dryRun: true });
    expect(report).toContain("stack-a");
    expect(report).toContain("stack-b");
    expect(report).toMatch(/dry-run/i);
    expect((await repo.remoteBookmarks()).map((b) => b.name)).not.toContain("stack-a");
  });
});

describe("operation log", () => {
  it("lists operations and restores an earlier one", async () => {
    const ops = await repo.operations(5);
    expect(ops).toHaveLength(5);
    expect(ops[0].current).toBe(true);
    expect(ops.slice(1).every((o) => !o.current)).toBe(true);
    expect(ops[0].user).toBeTruthy();
    expect(Date.parse(ops[0].time)).not.toBeNaN();

    jj("bookmark", "create", "temp", "-r", "@");
    expect(await repo.bookmarkNames()).toContain("temp");
    await repo.restoreOperation(ops[0].id);
    expect(await repo.bookmarkNames()).not.toContain("temp");
  });
});

describe("after a PR merges", () => {
  it("rebases work on top onto trunk, abandons the merged revisions and deletes the bookmark", async () => {
    // feature (bookmark pr-1) ← follow-up, then pr-1 is "squash merged" into trunk.
    jj("new", "main", "-m", "pr one");
    writeFileSync(join(dir, "pr1.txt"), "1\n");
    jj("bookmark", "create", "pr-1", "-r", "@");
    jj("new", "-m", "follow-up");
    writeFileSync(join(dir, "follow.txt"), "f\n");
    jj("new", "main", "-m", "squash merge of pr one");
    writeFileSync(join(dir, "pr1.txt"), "1\n");
    jj("bookmark", "set", "main", "-r", "@");
    await repo.push({ bookmarks: ["main"] });
    jj("new");

    const result = await repo.cleanUpMergedBookmark("pr-1");
    expect(result).toEqual({ rebased: 1, abandoned: 1 });
    expect(one(`${idOf("follow-up")}-`)).toBe(idOf("squash merge of pr one"));
    expect(idOf("pr one")).toBe(""); // abandoned
    expect(await repo.bookmarkNames()).not.toContain("pr-1");
  });
});
