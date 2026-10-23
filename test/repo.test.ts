import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JjRepo } from "../src/jj/repo";
import { layoutGraph } from "../src/shared/graph";

// Integration tests against a real jj repo. Requires jj on PATH, or set JJ_BIN
// to test another jj build (e.g. an older release).
const JJ = process.env.JJ_BIN ?? "jj";
let dir: string;
let repo: JjRepo;
const lines: string[] = [];

function jj(...args: string[]) {
  return execFileSync(JJ, ["--color=never", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function idOf(desc: string) {
  return jj("log", "--no-graph", "-r", `description(exact:"${desc}\n")`, "-T", "change_id").trim();
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vj-test-"));
  jj("git", "init", ".");
  jj("config", "set", "--repo", "user.name", "Test");
  jj("config", "set", "--repo", "user.email", "test@example.com");
  writeFileSync(join(dir, "a.txt"), "a\n");
  jj("describe", "-m", "base");
  jj("bookmark", "create", "main", "-r", "@");
  jj("new", "-m", "feature one");
  writeFileSync(join(dir, "b.txt"), "b\n");
  writeFileSync(join(dir, "c.txt"), "c\n");
  jj("new", "-m", "feature two");
  writeFileSync(join(dir, "d.txt"), "d\n");
  jj("new", "main", "-m", "side");
  writeFileSync(join(dir, "a.txt"), "a changed\n");
  repo = new JjRepo(() => JJ, dir, { append: (l) => lines.push(l) });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("JjRepo", () => {
  it("reads the jj version", async () => {
    const version = await repo.version();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(repo.atLeast("0.27.0")).toBe(true);
  });

  it("parses the log", async () => {
    const revs = await repo.log("all()", 100);
    const descs = revs.map((r) => r.description.trim());
    expect(descs).toEqual(expect.arrayContaining(["base", "feature one", "feature two", "side"]));
    const wc = revs.find((r) => r.isWorkingCopy)!;
    expect(wc.description.trim()).toBe("side");
    const base = revs.find((r) => r.description.trim() === "base")!;
    expect(base.localBookmarks.map((b) => b.name)).toEqual(["main"]);
    expect(revs.find((r) => r.root)).toBeTruthy();
    expect(base.inTrunk).toBe(false);
    expect(Date.parse(wc.timestamp)).not.toBeNaN();
    expect(wc.short.prefix.length + wc.short.rest.length).toBe(8);
    expect(wc.parents).toHaveLength(1);
  });

  it("lists changed files with line counts", async () => {
    const files = await repo.files(idOf("feature one"));
    expect(files.map((f) => f.path).sort()).toEqual(["b.txt", "c.txt"]);
    expect(files.every((f) => f.status === "added" && f.added === 1 && f.removed === 0)).toBe(true);
  });

  it("pushes a new bookmark and shows the remote bookmark", async () => {
    const remote = mkdtempSync(join(tmpdir(), "vj-remote-"));
    try {
      execFileSync("git", ["init", "--bare", "-q", remote]);
      jj("git", "remote", "add", "origin", remote);
      await repo.push({ bookmarks: ["main"] });
      const base = (await repo.log("all()", 100)).find((r) => r.description.trim() === "base")!;
      expect(base.remoteBookmarks).toContainEqual({ name: "main", remote: "origin", targets: [base.commitId] });
      expect(base.localBookmarks[0].targets).toEqual([base.commitId]);
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  });

  it("reads the last operation", async () => {
    const op = await repo.lastOperation();
    expect(op?.id).toBeTruthy();
    expect(Date.parse(op!.time)).not.toBeNaN();
  });

  it("describes, moves files and rebases", async () => {
    const one = idOf("feature one");
    const two = idOf("feature two");
    await repo.describe(one, "feature one (edited)");
    expect(idOf("feature one (edited)")).toBe(one);

    await repo.moveFiles(one, two, ["c.txt"]);
    expect((await repo.files(one)).map((f) => f.path)).toEqual(["b.txt"]);
    expect((await repo.files(two)).map((f) => f.path).sort()).toEqual(["c.txt", "d.txt"]);

    const side = idOf("side");
    await repo.rebase("s", two, "o", side);
    const parent = jj("log", "--no-graph", "-r", `${two}-`, "-T", "change_id").trim();
    expect(parent).toBe(side);

    await repo.undo();
    const parentAfterUndo = jj("log", "--no-graph", "-r", `${two}-`, "-T", "change_id").trim();
    expect(parentAfterUndo).toBe(one);
  });

  it("logs commands it runs", () => {
    expect(lines.some((l) => /^\$ \S*jj describe/.test(l))).toBe(true);
  });

  it("lays out the graph", async () => {
    const revs = await repo.log("all()", 100);
    const layout = layoutGraph(revs);
    expect(layout.rows).toHaveLength(revs.length);
    expect(layout.laneCount).toBe(2);
  });
});
