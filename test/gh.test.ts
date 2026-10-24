import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitHub } from "../src/github/gh";

/** A fake gh that records each call's args and GH_REPO, and lists the given extensions. */
function fakeGh(extensions: string, linkFails = false) {
  const dir = mkdtempSync(join(tmpdir(), "vj-gh-"));
  const calls = join(dir, "calls.log");
  const script = join(dir, "gh");
  writeFileSync(
    script,
    `#!/bin/sh
echo "$* | GH_REPO=$GH_REPO" >> "${calls}"
case "$1 $2" in
  "extension list") printf '%s\\n' "${extensions}" ;;
  "stack link") ${linkFails ? 'echo "stacked PRs are not enabled" >&2; exit 1' : "echo linked"} ;;
esac
`,
  );
  chmodSync(script, 0o755);
  const gh = new GitHub(() => script, dir, { append: () => undefined }, "acme/widgets");
  return { gh, calls: () => readFileSync(calls, "utf8").trim().split("\n") };
}

describe("gh stack", () => {
  it("detects the extension", async () => {
    expect(await fakeGh("gh stack\tgithub/gh-stack\tv0.2.1").gh.hasStackExtension()).toBe(true);
    expect(await fakeGh("gh dash\tdlvhdr/gh-dash\tv4.0.0").gh.hasStackExtension()).toBe(false);
    expect(await fakeGh("").gh.hasStackExtension()).toBe(false);
  });

  it("links PRs bottom to top without pushing, naming the repo", async () => {
    const { gh, calls } = fakeGh("gh stack\tgithub/gh-stack\tv0.2.1");
    const url = (n: number) => `https://github.com/acme/widgets/pull/${n}`;
    await gh.linkStack([url(10), url(11)], "main");
    expect(calls()).toEqual([`stack link --base main ${url(10)} ${url(11)} | GH_REPO=acme/widgets`]);
  });

  it("reports link failures", async () => {
    const { gh } = fakeGh("gh stack\tgithub/gh-stack\tv0.2.1", true);
    await expect(gh.linkStack(["u1", "u2"], "main")).rejects.toThrow(/not enabled/);
  });
});
