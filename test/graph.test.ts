import { describe, expect, it } from "vitest";
import { activeLine, groupStacks, layoutGraph } from "../src/shared/graph";
import type { Revision } from "../src/shared/types";

function r(id: string, parents: string[]): Revision {
  return {
    changeId: id,
    commitId: id,
    short: { prefix: id, rest: "" },
    commitShort: id,
    description: id,
    authorName: "",
    authorEmail: "",
    timestamp: "",
    parents,
    localBookmarks: [],
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
  };
}

describe("layoutGraph", () => {
  it("keeps a linear history in one lane", () => {
    const layout = layoutGraph([r("c", ["b"]), r("b", ["a"]), r("a", [])]);
    expect(layout.laneCount).toBe(1);
    expect(layout.rows.map((x) => x.col)).toEqual([0, 0, 0]);
  });

  it("puts a side branch in a second lane and merges it back", () => {
    // d and c both have parent a; b is a child of c.
    const layout = layoutGraph([r("d", ["a"]), r("b", ["c"]), r("c", ["a"]), r("a", [])]);
    expect(layout.rows.map((x) => x.col)).toEqual([0, 1, 1, 0]);
    expect(layout.laneCount).toBe(2);
    const cRow = layout.rows[2];
    // c's edge to a joins lane 0, which also passes straight through.
    expect(cRow.segments).toContainEqual({ fromCol: 1, from: "center", toCol: 0, to: "bottom" });
    expect(cRow.segments).toContainEqual({ fromCol: 0, from: "center", toCol: 0, to: "bottom" });
    const aRow = layout.rows[3];
    expect(aRow.segments.filter((s) => s.from === "top")).toHaveLength(1);
  });

  it("draws a dashed stub when the parent is hidden", () => {
    const layout = layoutGraph([r("b", ["hidden"])]);
    expect(layout.rows[0].elidedBelow).toBe(true);
    expect(layout.rows[0].segments).toContainEqual({ fromCol: 0, from: "center", toCol: 0, to: "bottom", dashed: true });
  });

  it("handles merge commits", () => {
    const layout = layoutGraph([r("m", ["x", "y"]), r("x", ["a"]), r("y", ["a"]), r("a", [])]);
    expect(layout.rows[0].segments.filter((s) => s.from === "center")).toHaveLength(2);
    expect(layout.rows.map((x) => x.col)).toEqual([0, 0, 1, 0]);
  });
});

describe("activeLine", () => {
  it("is the working copy with its ancestors and descendants", () => {
    // trunk ← a ← @ ← c, and a side branch trunk ← s
    const wc = { ...r("w", ["a"]), isWorkingCopy: true };
    const revs = [r("c", ["w"]), wc, r("s", ["trunk"]), r("a", ["trunk"]), r("trunk", [])];
    expect([...activeLine(revs)].sort()).toEqual(["a", "c", "trunk", "w"]);
  });

  it("is empty when the working copy isn't shown", () => {
    expect(activeLine([r("a", [])]).size).toBe(0);
  });
});

describe("groupStacks", () => {
  const ids = (revs: Revision[]) => groupStacks(revs).map((x) => x.changeId).join(" ");
  const wc = (id: string, parents: string[]) => ({ ...r(id, parents), isWorkingCopy: true });

  it("keeps parallel stacks together, @'s stack first", () => {
    // jj log --no-graph order: newest first, so the stacks interleave.
    const revs = [r("a3", ["a2"]), wc("b3", ["b2"]), r("a2", ["a1"]), r("b2", ["b1"]), r("a1", ["base"]), r("b1", ["base"]), r("base", [])];
    expect(ids(revs)).toBe("b3 b2 b1 a3 a2 a1 base");
  });

  it("puts the stack holding @ first when @ is in the middle of it", () => {
    const revs = [r("x2", ["x1"]), r("a2", ["a1"]), r("a1", ["base"]), wc("x1", ["base"]), r("base", [])];
    expect(ids(revs)).toBe("x2 x1 a2 a1 base");
  });

  it("keeps the newest-first order of other stacks", () => {
    const revs = [r("c1", ["base"]), r("a1", ["base"]), wc("w", ["base"]), r("base", [])];
    expect(ids(revs)).toBe("w c1 a1 base");
  });

  it("shows a merge's parents after it, first parent's line first", () => {
    const revs = [wc("m", ["p1", "p2"]), r("p2", ["base"]), r("p1", ["base"]), r("base", [])];
    expect(ids(revs)).toBe("m p1 p2 base");
  });

  it("leaves parents outside the revset alone", () => {
    const revs = [r("a", ["hidden"]), wc("b", ["hidden2"])];
    expect(ids(revs)).toBe("b a");
  });
});
