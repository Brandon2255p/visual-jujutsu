import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { JjRepo } from "../src/jj/repo";

// Integration test: parallel stacks come back grouped. Set JJ_BIN to test another jj build.
const JJ = process.env.JJ_BIN ?? "jj";
let dir: string;

function jj(...args: string[]) {
  return execFileSync(JJ, ["--color=never", ...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vj-stacks-"));
  jj("git", "init", ".");
  jj("config", "set", "--repo", "user.name", "Test");
  jj("config", "set", "--repo", "user.email", "test@example.com");
  jj("describe", "-m", "base");
  jj("new", "-m", "a1");
  jj("new", "-m", "a2");
  jj("new", 'description(exact:"base\n")', "-m", "b1");
  jj("new", "-m", "b2");
  jj("new", 'description(exact:"a2\n")', "-m", "a3");
  jj("new", 'description(exact:"b2\n")', "-m", "b3");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("lists each stack together, @'s stack first", async () => {
  // jj log --no-graph alone would give b3 a3 b2 b1 a2 a1 base.
  const repo = new JjRepo(() => JJ, dir, { append: () => undefined });
  const revs = await repo.log("description(regex:'.')", 50);
  expect(revs.map((r) => r.description.trim()).join(" ")).toBe("b3 b2 b1 a3 a2 a1 base");
});
