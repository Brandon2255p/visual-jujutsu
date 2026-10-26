import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commonJjPaths, locateJj } from "../src/jj/locate";
import { JjRepo } from "../src/jj/repo";

const JJ = process.env.JJ_BIN ?? execFileSync("which", ["jj"], { encoding: "utf8" }).trim();
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vj-locate-"));
  symlinkSync(JJ, join(dir, "jj"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("locateJj", () => {
  it("keeps a configured path as is", async () => {
    expect(await locateJj("/somewhere/jj", [join(dir, "jj")])).toBe("/somewhere/jj");
  });

  it("falls back to an install location when jj isn't on PATH", async () => {
    const path = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      expect(await locateJj("jj", ["/nonexistent/jj", join(dir, "jj")])).toBe(join(dir, "jj"));
      expect(await locateJj("jj", ["/nonexistent/jj"])).toBe("jj");
    } finally {
      process.env.PATH = path;
    }
  });

  it("lists the usual places", () => {
    expect(commonJjPaths("/home/u", "linux")).toContain("/home/u/.cargo/bin/jj");
    expect(commonJjPaths("/Users/u", "darwin")).toContain("/opt/homebrew/bin/jj");
  });
});

describe("findRoot", () => {
  it("returns null outside a repo and throws when jj can't run", async () => {
    expect(await JjRepo.findRoot(JJ, dir)).toBeNull();
    await expect(JjRepo.findRoot("/nonexistent/jj", dir)).rejects.toThrow(/ENOENT/);
  });
});
