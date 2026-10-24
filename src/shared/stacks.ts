import type { PullRequest, Revision } from "./types";

export interface StackEntry {
  revision: Revision;
  /** First local bookmark on the revision, if any. */
  bookmark: string | null;
  /** Open PR whose head is that bookmark. */
  pr: PullRequest | null;
}

/** Open PRs by head bookmark name. */
export function openPrsByHead(prs: PullRequest[]): Map<string, PullRequest> {
  return new Map(prs.filter((p) => p.state === "OPEN").map((p) => [p.headRefName, p]));
}

/**
 * The revision and its first-parent ancestors down to (and including) the
 * first trunk or immutable revision. Entries are top first.
 */
export function stackFor(revisions: Revision[], changeId: string, prs: PullRequest[]): StackEntry[] {
  const byCommit = new Map(revisions.map((r) => [r.commitId, r]));
  const open = openPrsByHead(prs);
  const entry = (r: Revision): StackEntry => {
    const bookmark = r.localBookmarks[0]?.name ?? null;
    return { revision: r, bookmark, pr: bookmark ? (open.get(bookmark) ?? null) : null };
  };
  const stack: StackEntry[] = [];
  let cur = revisions.find((r) => r.changeId === changeId);
  while (cur && stack.length < 50) {
    stack.push(entry(cur));
    if (cur.immutable || cur.inTrunk) break;
    cur = byCommit.get(cur.parents[0]);
  }
  return stack;
}

/** The bookmark name of trunk, e.g. "main". */
export function trunkBookmark(revisions: Revision[]): string {
  return revisions.find((r) => r.inTrunk && r.localBookmarks.length)?.localBookmarks[0].name ?? "main";
}

/**
 * The base a PR at `index` in the stack should target: the nearest bookmark
 * below it that has an open PR, otherwise trunk.
 */
export function expectedBase(stack: StackEntry[], index: number, trunk: string): { base: string; below: StackEntry | null } {
  const below = stack.slice(index + 1).find((s) => !s.revision.inTrunk && !s.revision.immutable && s.bookmark && s.pr) ?? null;
  return { base: below?.bookmark ?? trunk, below };
}

export interface SyncPlan {
  /** Bookmarks in the stack to push (bottom first). */
  push: string[];
  /** PRs whose base should change. */
  retarget: { pr: PullRequest; from: string; to: string }[];
}

/** What "Sync stack" will do for the stack below (and including) a revision. */
export function syncPlan(stack: StackEntry[], trunk: string): SyncPlan {
  const mutable = stack.filter((s) => !s.revision.inTrunk && !s.revision.immutable);
  const retarget: SyncPlan["retarget"] = [];
  stack.forEach((s, i) => {
    if (!s.pr || s.revision.inTrunk || s.revision.immutable) return;
    const { base } = expectedBase(stack, i, trunk);
    if (s.pr.baseRefName !== base) retarget.push({ pr: s.pr, from: s.pr.baseRefName, to: base });
  });
  return {
    push: mutable
      .filter((s) => s.bookmark)
      .map((s) => s.bookmark!)
      .reverse(),
    retarget: retarget.reverse(),
  };
}

export interface PrGroups {
  /** Chains of open PRs linked by base → head, each listed top first. */
  stacks: PullRequest[][];
  /** Merged PRs whose head bookmark still exists locally (candidates for cleanup), newest first. */
  mergedWithBookmark: PullRequest[];
}

/**
 * Groups open PRs into stacks. A PR's parent is the PR below it in the graph
 * when known (`graphParents`: head → head), otherwise the PR its base points at.
 */
export function groupPullRequests(prs: PullRequest[], localBookmarks: string[], graphParents = new Map<string, string>()): PrGroups {
  const open = prs.filter((p) => p.state === "OPEN");
  const heads = new Map(open.map((p) => [p.headRefName, p]));
  const parentOf = (p: PullRequest) => {
    const fromGraph = graphParents.get(p.headRefName);
    if (fromGraph && heads.has(fromGraph)) return fromGraph;
    return heads.has(p.baseRefName) ? p.baseRefName : null;
  };
  const childrenOf = new Map<string, PullRequest[]>();
  for (const p of open) {
    const parent = parentOf(p);
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), p]);
  }
  const stacks: PullRequest[][] = [];
  const roots = open.filter((p) => !parentOf(p)).sort((a, b) => b.number - a.number);
  for (const root of roots) {
    // Depth-first so a branching stack still lists every PR once.
    const chain: PullRequest[] = [];
    const visit = (p: PullRequest) => {
      chain.push(p);
      for (const c of (childrenOf.get(p.headRefName) ?? []).sort((a, b) => a.number - b.number)) visit(c);
    };
    visit(root);
    stacks.push(chain.reverse());
  }
  const local = new Set(localBookmarks);
  const mergedWithBookmark = prs
    .filter((p) => p.state === "MERGED" && local.has(p.headRefName) && !heads.has(p.headRefName))
    .sort((a, b) => (b.mergedAt ?? "").localeCompare(a.mergedAt ?? ""));
  return { stacks, mergedWithBookmark };
}
