import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JjRepo } from "../src/jj/repo";

// Integration test for the rebase preview. Set JJ_BIN to test another jj build.
const JJ = process.env.JJ_BIN ?? "jj";
let dir: string;
let repo: JjRepo;

function jj(...args: string[]) {
  return execFileSync(JJ, ["--color=never", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const one = (revset: string, template = "change_id") => jj("log", "--no-graph", "-r", revset, "-T", template).trim();
const idOf = (desc: string) => one(`description(exact:"${desc}\n")`);
const graph = () => jj("log", "--no-graph", "-r", "all()", "-T", 'commit_id ++ " " ++ parents.map(|p| p.commit_id()).join(",") ++ "\n"');
const ops = () => jj("op", "log", "--no-graph", "-T", 'self.id() ++ "\n"');

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "vj-preview-"));
  jj("git", "init", ".");
  jj("config", "set", "--repo", "user.name", "Test");
  jj("config", "set", "--repo", "user.email", "test@example.com");
  writeFileSync(join(dir, "a.txt"), "base\n");
  jj("describe", "-m", "base");
  jj("bookmark", "create", "main", "-r", "@");
  jj("new", "-m", "left");
  writeFileSync(join(dir, "a.txt"), "left\n");
  jj("new", "main", "-m", "right");
  writeFileSync(join(dir, "a.txt"), "right\n");
  // The working copy sits on top of "right", with an unsnapshotted edit.
  jj("new", "-m", "wc");
  writeFileSync(join(dir, "w.txt"), "unsaved\n");
  repo = new JjRepo(() => JJ, dir, { append: () => undefined });
  await repo.version();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("rebase preview", () => {
  it("shows the result and the new conflicts, then leaves the repo as it was", async () => {
    const right = idOf("right");
    const left = idOf("left");
    // Snapshot first so the comparison below includes w.txt.
    jj("status");
    const graphBefore = graph();
    const opsBefore = ops();

    const { before, after } = await repo.previewRebase("s", right, "o", left);

    const byDesc = (revs: typeof before, d: string) => revs.find((r) => r.description.trim() === d);
    expect(byDesc(before, "right")?.conflict).toBe(false);
    expect(byDesc(after, "right")?.conflict).toBe(true);
    expect(byDesc(after, "right")?.parents).toEqual([byDesc(after, "left")?.commitId]);
    expect(byDesc(after, "wc")?.isWorkingCopy).toBe(true);

    // Same commits and working copy. jj can't abandon the current operation,
    // so one "restore" operation is left on top of the history we started with.
    expect(graph()).toBe(graphBefore);
    expect(ops().split("\n").slice(1).join("\n")).toBe(opsBefore);
    expect(jj("op", "log", "-n", "1", "--no-graph", "-T", "description")).toMatch(/restore/);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("right\n");
    expect(readFileSync(join(dir, "w.txt"), "utf8")).toBe("unsaved\n");
    expect(jj("status")).not.toMatch(/stale/i);
  });

  it("snapshots unsaved working-copy edits before previewing", async () => {
    writeFileSync(join(dir, "w.txt"), "edited again\n");
    await repo.previewRebase("r", idOf("wc"), "o", "main");
    expect(readFileSync(join(dir, "w.txt"), "utf8")).toBe("edited again\n");
    expect(jj("file", "show", "-r", "@", "w.txt")).toBe("edited again\n");
  });

  it("restores nothing when the rebase is refused", async () => {
    const opsBefore = ops();
    await expect(repo.previewRebase("s", idOf("base"), "o", idOf("wc"))).rejects.toThrow();
    expect(ops()).toBe(opsBefore);
  });
});
