import type { GraphLayout, GraphRow, GraphSegment, Revision } from "./types";

const ROOT_COMMIT = "0000000000000000000000000000000000000000";

/**
 * Reorders revisions so each line of work stays together, like `jj log` does.
 *
 * `jj log --no-graph` lists revisions newest first, so stacks worked on in
 * parallel interleave. This walks down from each head instead: the stack
 * holding @ first, then the other heads newest first. A revision is shown once
 * all its shown children are, so shared history comes after every stack on it.
 */
export function groupStacks(revisions: Revision[]): Revision[] {
  const byCommit = new Map(revisions.map((r) => [r.commitId, r]));
  const children = new Map<string, number>();
  for (const r of revisions) for (const p of new Set(r.parents)) {
    if (byCommit.has(p)) children.set(p, (children.get(p) ?? 0) + 1);
  }
  const heads = revisions.filter((r) => !children.has(r.commitId));
  // Heads on top of @ (or @ itself) come first.
  const wc = revisions.find((r) => r.isWorkingCopy);
  const aboveWc = (head: Revision) => {
    const seen = new Set<string>();
    const stack = [head];
    while (stack.length) {
      const r = stack.pop()!;
      if (r === wc) return true;
      for (const p of r.parents) {
        const parent = byCommit.get(p);
        if (parent && !seen.has(p)) {
          seen.add(p);
          stack.push(parent);
        }
      }
    }
    return false;
  };
  const ordered = wc ? [...heads.filter(aboveWc), ...heads.filter((h) => !aboveWc(h))] : heads;

  const out: Revision[] = [];
  const emitted = new Set<string>();
  // Last in, first out: after a revision, its first parent is next, so a stack is followed down.
  const ready = [...ordered].reverse();
  while (ready.length) {
    const r = ready.pop()!;
    if (emitted.has(r.commitId)) continue;
    emitted.add(r.commitId);
    out.push(r);
    const parents = [...new Set(r.parents)].map((p) => byCommit.get(p)).filter((p): p is Revision => !!p);
    for (const p of [...parents].reverse()) {
      const left = children.get(p.commitId)! - 1;
      children.set(p.commitId, left);
      if (left === 0) ready.push(p);
    }
  }
  // Anything unreached (shouldn't happen) keeps jj's order at the end.
  for (const r of revisions) if (!emitted.has(r.commitId)) out.push(r);
  return out;
}

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

/**
 * The change ids on the working copy's line of work: @ with its ancestors and
 * descendants among the shown revisions. Their nodes are drawn filled.
 */
export function activeLine(revisions: Revision[]): Set<string> {
  const wc = revisions.find((r) => r.isWorkingCopy);
  if (!wc) return new Set();
  const byCommit = new Map(revisions.map((r) => [r.commitId, r]));
  const children = new Map<string, Revision[]>();
  for (const r of revisions) for (const p of r.parents) {
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(r);
  }
  const active = new Set<string>([wc.changeId]);
  const walk = (start: Revision, next: (r: Revision) => (Revision | undefined)[]) => {
    const stack = [start];
    const seen = new Set<string>();
    while (stack.length) {
      for (const n of next(stack.pop()!)) {
        if (!n || seen.has(n.commitId)) continue;
        seen.add(n.commitId);
        active.add(n.changeId);
        stack.push(n);
      }
    }
  };
  walk(wc, (r) => r.parents.map((p) => byCommit.get(p)));
  walk(wc, (r) => children.get(r.commitId) ?? []);
  return active;
}
