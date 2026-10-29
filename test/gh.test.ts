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

describe("pull request actions", () => {
  it("marks ready and closes, optionally deleting the branch", async () => {
    const { gh, calls } = fakeGh("");
    await gh.markReady(7);
    await gh.close(7, false);
    await gh.close(8, true);
    expect(calls()).toEqual([
      "pr ready 7 --repo acme/widgets | GH_REPO=",
      "pr close 7 --repo acme/widgets | GH_REPO=",
      "pr close 8 --repo acme/widgets --delete-branch | GH_REPO=",
    ]);
  });
});

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

describe("pull requests", () => {
  /** A fake gh whose GraphQL calls answer with the given pages in turn; "fail" makes that call error. */
  function pagedGh(pages: (object | "fail")[]) {
    const dir = mkdtempSync(join(tmpdir(), "vj-gh-"));
    const calls = join(dir, "calls.log");
    pages.forEach((p, i) => writeFileSync(join(dir, `page${i}.json`), JSON.stringify(p)));
    const script = join(dir, "gh");
    writeFileSync(
      script,
      `#!/bin/sh
n=$(cat "${dir}/count" 2>/dev/null || echo 0); echo $((n + 1)) > "${dir}/count"
printf '%s' "$*" | tr '\\n' ' ' >> "${calls}"; echo >> "${calls}"
grep -q '"fail"' "${dir}/page$n.json" && { echo "HTTP 504: Gateway Timeout" >&2; exit 1; }
cat "${dir}/page$n.json"
`,
    );
    chmodSync(script, 0o755);
    const gh = new GitHub(() => script, dir, { append: () => undefined }, "acme/widgets");
    return { gh, calls: () => readFileSync(calls, "utf8").split("\n").filter((l) => l.trim()) };
  }

  const pr = (number: number, rollupState: string | null) => ({
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    headRefName: `b${number}`,
    baseRefName: "main",
    state: "OPEN",
    isDraft: false,
    reviewDecision: null,
    mergedAt: null,
    commits: { nodes: [{ commit: { statusCheckRollup: rollupState ? { state: rollupState } : null } }] },
  });
  const page = (nodes: object[], hasNextPage: boolean, endCursor: string | null) => ({
    data: { repository: { pullRequests: { nodes, pageInfo: { hasNextPage, endCursor } } } },
  });

  it("fetches two pages of 25, passing the cursor", async () => {
    const { gh, calls } = pagedGh([page([pr(2, "SUCCESS")], true, "CUR1"), page([pr(1, "FAILURE")], true, "CUR2")]);
    const prs = await gh.pullRequests();
    expect(prs.map((p) => [p.number, p.checks])).toEqual([
      [2, "passing"],
      [1, "failing"],
    ]);
    const log = calls();
    expect(log).toHaveLength(2);
    expect(log[0]).toContain("first=25");
    expect(log[0]).not.toContain("after=");
    expect(log[1]).toContain("after=CUR1");
  });

  it("stops when there is no next page", async () => {
    const { gh, calls } = pagedGh([page([pr(1, null)], false, null)]);
    expect((await gh.pullRequests()).map((p) => p.checks)).toEqual(["none"]);
    expect(calls()).toHaveLength(1);
  });

  it("keeps the first page when the second fails", async () => {
    const { gh } = pagedGh([page([pr(3, "PENDING")], true, "CUR1"), "fail"]);
    expect((await gh.pullRequests()).map((p) => [p.number, p.checks])).toEqual([[3, "pending"]]);
  });

  it("throws when the first page fails", async () => {
    const { gh } = pagedGh(["fail"]);
    await expect(gh.pullRequests()).rejects.toThrow(/504/);
  });
});
