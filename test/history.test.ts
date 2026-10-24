import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JjRepo } from "../src/jj/repo";

// Integration tests for duplicate, the evolution log and divergent changes.
// Set JJ_BIN to test another jj build.
const JJ = process.env.JJ_BIN ?? "jj";
let dir: string;
let repo: JjRepo;

function jj(...args: string[]) {
  return execFileSync(JJ, ["--color=never", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const one = (revset: string, template = "change_id") => jj("log", "--no-graph", "-r", revset, "-T", template).trim();
const idOf = (desc: string) => one(`description(exact:"${desc}\n")`);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "vj-history-"));
  jj("git", "init", ".");
  jj("config", "set", "--repo", "user.name", "Test");
  jj("config", "set", "--repo", "user.email", "test@example.com");
  writeFileSync(join(dir, "a.txt"), "v1\n");
  jj("describe", "-m", "feature");
  writeFileSync(join(dir, "a.txt"), "v2\n");
  writeFileSync(join(dir, "b.txt"), "new\n");
  jj("describe", "-m", "feature v2");
  jj("new");
  repo = new JjRepo(() => JJ, dir, { append: () => undefined });
  await repo.version();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("evolution log", () => {
  it("lists every version of a change, newest first", async () => {
    const entries = await repo.evolog(idOf("feature v2"));
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(entries[0].description.trim()).toBe("feature v2");
    expect(entries.some((e) => e.description.trim() === "feature")).toBe(true);
    expect(entries[0].time).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("diffs two versions and restores an earlier one", async () => {
    const id = idOf("feature v2");
    const entries = await repo.evolog(id);
    // The oldest version described "feature" still has a.txt at v1 (later snapshots picked up v2).
    const first = [...entries].reverse().find((e) => e.description.trim() === "feature")!;
    const files = await repo.diffBetween(first.commitId, entries[0].commitId);
    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "a.txt", status: "modified", added: 1, removed: 1 }),
        expect.objectContaining({ path: "b.txt", status: "added", added: 1 }),
      ]),
    );
    await repo.restoreFrom(first.commitId, id);
    expect(jj("file", "show", "-r", id, "a.txt")).toBe("v1\n");
    expect(jj("file", "list", "-r", id)).not.toContain("b.txt");
    // The description is kept.
    expect(one(id, "description").trim()).toBe("feature v2");
  });
});

describe("duplicate and divergence", () => {
  it("duplicates a revision", async () => {
    const before = one(`description(exact:"feature v2\n")`, 'change_id ++ "\\n"').split("\n").length;
    await repo.duplicate(idOf("feature v2"));
    expect(jj("log", "--no-graph", "-r", `description(exact:"feature v2\n")`, "-T", 'change_id ++ "\\n"').trim().split("\n").length).toBe(before + 1);
  });

  it("addresses divergent revisions by commit ID and lists both sides", async () => {
    jj("new", "root()", "-m", "div");
    const change = one("@");
    const op = jj("op", "log", "-n", "1", "--no-graph", "-T", "self.id()").trim();
    jj("describe", "-m", "left");
    jj("--at-op", op, "describe", "-m", "right");
    jj("status"); // resolves the concurrent operations, leaving the change divergent

    const revs = await repo.log("all()", 50);
    const sides = revs.filter((r) => r.divergentChangeId === change);
    expect(sides).toHaveLength(2);
    // Each side's changeId is its commit ID, so they're distinct and usable as revsets.
    expect(sides.map((r) => r.changeId).sort()).toEqual(sides.map((r) => r.commitId).sort());
    expect((await repo.commitsOfChange(change)).map((r) => r.commitId).sort()).toEqual(sides.map((r) => r.commitId).sort());

    // Keep one side by abandoning the other.
    const keep = sides.find((r) => r.description.trim() === "left")!;
    await repo.abandon(sides.filter((r) => r !== keep).map((r) => r.changeId));
    const after = await repo.commitsOfChange(change);
    expect(after.map((r) => r.description.trim())).toEqual(["left"]);
    expect(after[0].divergent).toBe(false);
  });
});
