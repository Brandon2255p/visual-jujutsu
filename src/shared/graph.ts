import type { GraphLayout, GraphRow, GraphSegment, Revision } from "./types";

const ROOT_COMMIT = "0000000000000000000000000000000000000000";

/**
 * Assigns each revision a lane and works out the line segments for its row.
 *
 * Revisions must be in jj log order (children before parents). Lanes never
 * shift sideways, so a lane that passes through a row is a straight line.
 * A lane is freed when the commit it was waiting for is drawn, and free
 * lanes are reused from the left.
 */
export function layoutGraph(revisions: Revision[]): GraphLayout {
  const visible = new Set(revisions.map((r) => r.commitId));
  // lanes[i] = commit id that lane i is heading towards, or null if free.
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  let laneCount = 0;

  const freeLane = () => {
    const i = lanes.indexOf(null);
    if (i >= 0) return i;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const rev of revisions) {
    const segments: GraphSegment[] = [];
    const incoming = lanes.flatMap((c, i) => (c === rev.commitId ? [i] : []));
    const col = incoming.length > 0 ? incoming[0] : freeLane();

    // Top half: lanes ending here converge on the node; others pass through.
    const passThrough = new Set<number>();
    lanes.forEach((c, i) => {
      if (c === null) return;
      if (c === rev.commitId) segments.push({ fromCol: i, from: "top", toCol: col, to: "center" });
      else {
        segments.push({ fromCol: i, from: "top", toCol: i, to: "center" });
        passThrough.add(i);
      }
    });
    for (const i of incoming) lanes[i] = null;

    // Bottom half: one edge per visible parent.
    const parents = rev.parents.filter((p) => p !== ROOT_COMMIT);
    const shown = parents.filter((p) => visible.has(p));
    const elidedBelow = shown.length < parents.length;
    shown.forEach((parent, idx) => {
      const existing = lanes.indexOf(parent);
      let target: number;
      if (existing >= 0) target = existing;
      else if (idx === 0 && lanes[col] === null) target = col;
      else target = freeLane();
      lanes[target] = parent;
      segments.push({ fromCol: col, from: "center", toCol: target, to: "bottom" });
    });
    if (elidedBelow && shown.length === 0) {
      segments.push({ fromCol: col, from: "center", toCol: col, to: "bottom", dashed: true });
    }

    for (const i of passThrough) {
      segments.push({ fromCol: i, from: "center", toCol: i, to: "bottom" });
    }

    // Trailing free lanes don't count towards the width.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    laneCount = Math.max(laneCount, lanes.length, col + 1);

    rows.push({
      changeId: rev.changeId,
      col,
      segments,
      lanesBelow: lanes.flatMap((c, i) => (c === null ? [] : [i])),
      elidedBelow,
    });
  }

  return { rows, laneCount: Math.max(laneCount, 1) };
}
