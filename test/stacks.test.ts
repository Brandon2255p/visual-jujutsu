import { describe, expect, it } from "vitest";
import { expectedBase, groupPullRequests, stackFor, stackPrs, syncPlan, trunkBookmark } from "../src/shared/stacks";
import type { PullRequest, Revision } from "../src/shared/types";

function rev(id: string, parent: string | null, bookmark: string | null, extra: Partial<Revision> = {}): Revision {
  return {
    changeId: id,
    commitId: "c" + id,
    short: { prefix: id, rest: "" },
    commitShort: id,
    description: id,
    authorName: "",
    authorEmail: "",
    timestamp: "",
    parents: parent ? ["c" + parent] : [],
    localBookmarks: bookmark ? [{ name: bookmark, targets: ["c" + id] }] : [],
    remoteBookmarks: [],
    tags: [],
    isWorkingCopy: false,
    immutable: false,
    empty: false,
    conflict: false,
    divergent: false,
    mine: true,
    root: false,
    inTrunk: false,
    ...extra,
  };
}

function pr(number: number, head: string, base: string, extra: Partial<PullRequest> = {}): PullRequest {
  return { number, title: head, url: "", headRefName: head, baseRefName: base, state: "OPEN", isDraft: false, checks: "none", review: "none", mergedAt: null, ...extra };
}

// main ← a (feat-a, #1) ← b (no bookmark) ← c (feat-c, #2) ← d (feat-d, no PR)
const revisions = [
  rev("d", "c", "feat-d"),
  rev("c", "b", "feat-c"),
  rev("b", "a", null),
  rev("a", "m", "feat-a"),
  rev("m", null, "main", { immutable: true, inTrunk: true }),
];

describe("stacks", () => {
  it("walks first parents down to trunk", () => {
    const stack = stackFor(revisions, "d", [pr(1, "feat-a", "main"), pr(2, "feat-c", "main")]);
    expect(stack.map((s) => s.revision.changeId)).toEqual(["d", "c", "b", "a", "m"]);
    expect(stack.map((s) => s.pr?.number ?? null)).toEqual([null, 2, null, 1, null]);
    expect(trunkBookmark(revisions)).toBe("main");
  });

  it("bases each PR on the nearest bookmark below with a PR", () => {
    const stack = stackFor(revisions, "d", [pr(1, "feat-a", "main"), pr(2, "feat-c", "main")]);
    expect(expectedBase(stack, 1, "main").base).toBe("feat-a");
    expect(expectedBase(stack, 3, "main").base).toBe("main");
  });

  it("plans pushes and base changes for Sync stack", () => {
    const stack = stackFor(revisions, "d", [pr(1, "feat-a", "main"), pr(2, "feat-c", "main")]);
    const plan = syncPlan(stack, "main");
    expect(plan.push).toEqual(["feat-a", "feat-c", "feat-d"]);
    expect(plan.retarget).toEqual([{ pr: expect.objectContaining({ number: 2 }), from: "main", to: "feat-a" }]);
  });

  it("needs no base changes when the stack is already in order", () => {
    const stack = stackFor(revisions, "c", [pr(1, "feat-a", "main"), pr(2, "feat-c", "feat-a")]);
    expect(syncPlan(stack, "main").retarget).toEqual([]);
  });

  it("groups open PRs into stacks and finds merged PRs to clean up", () => {
    const prs = [
      pr(2, "feat-c", "feat-a"),
      pr(1, "feat-a", "main"),
      pr(3, "docs", "main"),
      pr(4, "old", "main", { state: "MERGED", mergedAt: "2026-10-01T00:00:00Z" }),
      pr(5, "gone", "main", { state: "MERGED", mergedAt: "2026-10-02T00:00:00Z" }),
      pr(6, "closed", "main", { state: "CLOSED" }),
    ];
    const groups = groupPullRequests(prs, ["feat-a", "feat-c", "old"]);
    expect(groups.stacks.map((s) => s.map((p) => p.number))).toEqual([[3], [2, 1]]);
    expect(groups.mergedWithBookmark.map((p) => p.number)).toEqual([4]);
  });

  it("groups by graph parents when a PR's base is out of date", () => {
    const prs = [pr(2, "feat-c", "main"), pr(1, "feat-a", "main")];
    expect(groupPullRequests(prs, []).stacks.map((s) => s.map((p) => p.number))).toEqual([[2], [1]]);
    const grouped = groupPullRequests(prs, [], new Map([["feat-c", "feat-a"]]));
    expect(grouped.stacks.map((s) => s.map((p) => p.number))).toEqual([[2, 1]]);
  });

  it("lists the stack's PRs bottom first for gh stack link", () => {
    const stack = stackFor(revisions, "d", [pr(1, "feat-a", "main"), pr(2, "feat-c", "feat-a"), pr(9, "main", "x")]);
    expect(stackPrs(stack).map((p) => p.number)).toEqual([1, 2]);
  });
});
