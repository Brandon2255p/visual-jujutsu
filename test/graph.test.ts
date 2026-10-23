import { describe, expect, it } from "vitest";
import { layoutGraph } from "../src/shared/graph";
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
