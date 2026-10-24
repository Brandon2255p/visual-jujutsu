// Fake extension host for previewing the webview in a plain browser
// (webview/dev.html). Not used inside VS Code.
import type { HostMessage, WebviewMessage } from "../../../src/shared/protocol";
import type { ChangedFile, EvologEntry, GraphState, Operation, Revision } from "../../../src/shared/types";
import { layoutGraph } from "../../../src/shared/graph";

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

function rev(
  id: string,
  parents: string[],
  description: string,
  min: number,
  extra: Partial<Revision> = {},
): Revision {
  return {
    changeId: id + "xxxxxxxxxxxxxxxxxxxxxxxxxx",
    commitId: "c_" + id,
    short: { prefix: id.slice(0, 2), rest: id.slice(2, 8) },
    commitShort: (id + "00000000").slice(0, 8),
    description,
    authorName: "Brandon",
    authorEmail: "brandon@example.com",
    timestamp: ago(min),
    parents: parents.map((p) => "c_" + p),
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
    ...extra,
  };
}

const bm = (name: string, target: string) => ({ name, targets: ["c_" + target] });

let revisions: Revision[] = [
  rev("kpquqkts", ["ryzxvmos"], "", 0, { isWorkingCopy: true, empty: true }),
  rev("ryzxvmos", ["wstlpqnk"], "feat(graph): render revision lanes\n\nDraw edges between lanes.\n", 12, {
    localBookmarks: [bm("graph-view", "ryzxvmos")],
  }),
  rev("wstlpqnk", ["knwyqlvz"], "feat(webview): scaffold webview panel\n", 60, {
    localBookmarks: [bm("webview", "wstlpqnk")],
    remoteBookmarks: [{ name: "webview", remote: "origin", targets: ["c_old"] }],
  }),
  rev("mzkroyxu", ["vnolmswp"], "fix(rebase): handle --insert-before\n", 180, {
    conflict: true,
    localBookmarks: [{ name: "rebase-fix", targets: ["c_mzkroyxu", "c_other"] }],
  }),
  rev("vnolmswp", ["knwyqlvz"], "refactor(jj): parse log via JSON template\n", 185),
  rev("tzynmlqe", ["knwyqlvz"], "docs: feature plan\n", 300, { empty: true }),
  rev("knwyqlvz", ["hidden"], "chore: initial extension scaffold\n", 1440, {
    immutable: true,
    inTrunk: true,
    localBookmarks: [bm("main", "knwyqlvz")],
    remoteBookmarks: [{ name: "main", remote: "origin", targets: ["c_knwyqlvz"] }],
    tags: ["v0.1.0"],
  }),
];

const pullRequests: GraphState["pullRequests"] = [
  // #12's base is main, but the revision below it has PR #11, so the PR view suggests Sync stack.
  { number: 12, title: "feat(graph): render revision lanes", url: "https://github.com/x/y/pull/12", headRefName: "graph-view", baseRefName: "main", state: "OPEN", isDraft: false, checks: "passing", review: "approved", mergedAt: null },
  { number: 11, title: "feat(webview): scaffold webview panel", url: "https://github.com/x/y/pull/11", headRefName: "webview", baseRefName: "main", state: "OPEN", isDraft: true, checks: "pending", review: "review_required", mergedAt: null },
  { number: 10, title: "chore: initial extension scaffold", url: "https://github.com/x/y/pull/10", headRefName: "scaffold", baseRefName: "main", state: "MERGED", isDraft: false, checks: "passing", review: "approved", mergedAt: ago(20) },
  { number: 9, title: "docs: add README and screenshots", url: "https://github.com/x/y/pull/9", headRefName: "docs-readme", baseRefName: "main", state: "OPEN", isDraft: false, checks: "failing", review: "changes_requested", mergedAt: null },
];

let revset = "";
const op = (id: string, description: string, min: number): Operation => ({ id, description, time: ago(min), user: "brandon@mbp", current: false });
let operations: Operation[] = [
  op("3f2a1c8e7d01", "describe commit ryzxvmos", 2),
  op("a91b0e2f6c33", "squash commits into mzkroyxu", 5),
  op("7c3d551a0b9e", "rebase commit vnolmswp", 9),
  op("e40f9b1d2a77", "fetch from git remote(s) origin", 14),
  op("19aa7c04be52", "new empty commit", 20),
  op("5be2d33f8a10", "push bookmark graph-view to git remote origin", 65),
  op("0d81e4f9c2d4", "snapshot working copy", 70),
];
operations[0].current = true;

// ?divergent shows vnolmswp as a divergent change: two commits, addressed by commit ID.
if (new URLSearchParams(location.search).has("divergent")) {
  const i = revisions.findIndex((r) => r.changeId.startsWith("vnolmswp"));
  const base = revisions[i];
  const side = (commit: string, description: string): Revision => ({
    ...base,
    changeId: commit,
    commitId: commit,
    commitShort: commit.slice(2, 10),
    divergentChangeId: base.changeId,
    divergent: true,
    description,
  });
  const a = side("c_vnolmswp", base.description);
  const b = side("c_vnolmswq", "refactor(jj): parse log via templates\n");
  revisions = revisions.flatMap((r) => (r === base ? [a, b] : r.parents.includes(base.commitId) ? [{ ...r }] : [r]));
}

function evologOf(changeId: string): EvologEntry[] {
  const rev = revisions.find((r) => r.changeId === changeId);
  const d = rev?.description ?? "";
  const entry = (n: number, description: string, min: number, operation: string, extra: Partial<EvologEntry> = {}): EvologEntry => ({
    commitId: `e${n}_${changeId}`.padEnd(40, "0"),
    commitShort: `e${n}${changeId.slice(0, 6)}`,
    description,
    time: ago(min),
    operation,
    empty: false,
    conflict: false,
    ...extra,
  });
  return [
    entry(4, d, 12, "rebase commit 7c3d551a onto main"),
    entry(3, d, 40, "describe commit 0d81e4f9"),
    entry(2, d.split("\n")[0].replace(/:.*/, ": wip") + "\n", 75, "snapshot working copy"),
    entry(1, "", 90, "new empty commit", { empty: true }),
  ];
}

let density: GraphState["density"] = new URLSearchParams(location.search).has("compact") ? "compact" : "comfortable";

function state(): GraphState {
  return {
    repoName: "visual-jujutsu",
    root: "/work/visual-jujutsu",
    repos: new URLSearchParams(location.search).has("multi")
      ? [{ root: "/work/visual-jujutsu", name: "visual-jujutsu" }, { root: "/work/inboxforge-ui", name: "inboxforge-ui" }]
      : [{ root: "/work/visual-jujutsu", name: "visual-jujutsu" }],
    jjVersion: "0.46.0",
    revset,
    presets: [
      { name: "Default", revset: "" },
      { name: "Mine", revset: "mine() | trunk() | @" },
      { name: "All", revset: "all()" },
    ],
    revisions,
    layout: layoutGraph(revisions),
    pullRequests,
    localBookmarks: [...new Set([...revisions.flatMap((r) => r.localBookmarks.map((b) => b.name)), "scaffold"])],
    github: true,
    lastOperation: operations[0],
    error: null,
    density,
  };
}

declare global {
  interface Window {
    __vjActions: unknown[];
  }
}
window.__vjActions = [];

export function handle(message: WebviewMessage, emit: (m: HostMessage) => void) {
  window.__vjActions.push(message);
  console.log("[mock host]", message);
  const mode = new URLSearchParams(location.search).get("mode") ?? "graph";
  switch (message.type) {
    case "ready":
      if (mode === "rebase") {
        emit({ type: "rebaseDialog", data: { revision: revisions[1], candidates: revisions.filter((_, i) => i !== 1), defaultDestination: revisions[6].changeId } });
      } else if (mode === "createPr") {
        emit({
          type: "createPrDialog",
          data: {
            revision: revisions[1],
            headOptions: ["graph-view", "push-ryzxvmosxxxx"],
            suggestedHead: "graph-view",
            baseOptions: ["main", "webview"],
            suggestedBase: "webview",
            baseReason: "The revision below has PR #11, so this PR stacks on it. Pick main to target trunk.",
            stack: [
              { revision: revisions[1], bookmark: "graph-view", pr: null },
              { revision: revisions[2], bookmark: "webview", pr: pullRequests[1] },
              { revision: revisions[6], bookmark: "main", pr: null },
            ],
          },
        });
      } else emit({ type: "state", state: state() });
      break;
    case "setRevset":
      revset = message.revset;
      emit({ type: "state", state: state() });
      break;
    case "rebasePreview": {
      // Apply the rebase to a copy of the sample graph, then put it back.
      const a = message.action;
      const saved = revisions;
      const before = revisions.filter((r) => !r.root);
      rebase(a.source, a.changeId, a.destination ?? revisions.find((r) => r.inTrunk)!.changeId);
      const was = new Map(saved.map((r) => [r.changeId, r.parents.join()]));
      const moved = revisions.filter((r) => was.get(r.changeId) !== r.parents.join()).map((r) => r.changeId);
      // Pretend rebasing onto the working copy conflicts, to show that state.
      const conflicts = revisions.some((r) => r.isWorkingCopy && r.changeId === a.destination) ? moved.slice(0, 1) : [];
      const after = revisions.filter((r) => !r.root).map((r) => (conflicts.includes(r.changeId) ? { ...r, conflict: true } : r));
      revisions = saved;
      setTimeout(() => emit({ type: "rebasePreview", preview: { before, after, moved, conflicts } }), 400);
      break;
    }
    case "loadEvolog":
      setTimeout(() => emit({ type: "evolog", changeId: message.changeId, entries: evologOf(message.changeId) }), 150);
      break;
    case "loadVersionFiles":
      emit({
        type: "files",
        changeId: message.key,
        files: message.from.startsWith("e1") ? [f("src/webview/graph.ts", "added", 120, 0)] : [f("src/webview/graph.ts", "modified", 22, 4), f("src/webview/lanes.ts", "added", 88, 0)],
      });
      break;
    case "loadOperations":
      emit({ type: "operations", operations });
      break;
    case "loadFiles":
      emit({ type: "files", changeId: message.changeId, files: filesOf(message.changeId) });
      break;
    case "action": {
      const a = message.action;
      if (a.kind === "setDensity") {
        density = a.density;
        emit({ type: "state", state: state() });
        break;
      }
      if (a.kind === "describe") {
        revisions = revisions.map((r) => (r.changeId === a.changeId ? { ...r, description: a.message + "\n" } : r));
      } else if (a.kind === "moveFiles") {
        const moving = filesOf(a.from).filter((f) => a.paths.includes(f.path));
        files.set(a.from, filesOf(a.from).filter((f) => !a.paths.includes(f.path)));
        files.set(a.into, [...filesOf(a.into), ...moving]);
      } else if (a.kind === "rebase" && a.target === "o" && a.destination) {
        rebase(a.source, a.changeId, a.destination);
      } else break;
      const short = (id: string) => id.slice(0, 8);
      const opText =
        a.kind === "describe" ? `describe commit ${short(a.changeId)}`
        : a.kind === "moveFiles" ? `squash --from ${short(a.from)} --into ${short(a.into)}`
        : `rebase -${a.source} ${short(a.changeId)} -o ${short(a.destination!)}`;
      operations = [
        { id: Math.random().toString(16).slice(2, 14), description: opText, time: new Date().toISOString(), user: "brandon@mbp", current: true },
        ...operations.map((o) => ({ ...o, current: false })),
      ];
      // Behave like the real host: show progress briefly, then the new state.
      emit({ type: "busy", busy: true, label: "Working…" });
      setTimeout(() => {
        emit({ type: "busy", busy: false });
        emit({ type: "state", state: state() });
      }, 350);
      break;
    }
  }
}

// ---- Simulated repo changes, so the dev harness and GIFs show real results.

const files = new Map<string, ChangedFile[]>();
const f = (path: string, status: ChangedFile["status"], added: number, removed: number): ChangedFile => ({ path, status, added, removed, conflict: false });

function filesOf(changeId: string): ChangedFile[] {
  if (!files.has(changeId)) {
    const id = changeId.slice(0, 8);
    files.set(
      changeId,
      id === "ryzxvmos"
        ? [f("src/webview/graph.ts", "modified", 142, 18), f("src/webview/lanes.ts", "added", 88, 0), f("package.json", "modified", 3, 1)]
        : id === "mzkroyxu"
          ? [f("src/jj/rebase.ts", "modified", 24, 6)]
          : id === "vnolmswp"
            ? [f("src/jj/repo.ts", "modified", 61, 40), f("src/jj/template.ts", "added", 35, 0)]
            : [f("README.md", "modified", 4, 1)],
    );
  }
  return files.get(changeId)!;
}

/** Applies `jj rebase -<source> <id> -o <dest>` to the sample graph. */
function rebase(source: "r" | "s" | "b", changeId: string, dest: string) {
  const byId = new Map(revisions.map((r) => [r.changeId, r]));
  const rev = byId.get(changeId);
  const target = byId.get(dest);
  if (!rev || !target) return;
  if (source === "r") {
    // Children of the moved revision take over its parents.
    revisions = revisions.map((r) => (r.parents.includes(rev.commitId) ? { ...r, parents: rev.parents } : r));
  }
  revisions = revisions.map((r) => (r.changeId === changeId ? { ...r, parents: [target.commitId] } : r));
  revisions = topoSort(revisions);
}

/** Children before parents, otherwise keeping the original order (like jj log). */
function topoSort(revs: Revision[]): Revision[] {
  const out: Revision[] = [];
  const done = new Set<string>();
  const childrenLeft = (r: Revision) => revs.some((c) => !done.has(c.commitId) && c.parents.includes(r.commitId));
  while (out.length < revs.length) {
    const next = revs.find((r) => !done.has(r.commitId) && !childrenLeft(r)) ?? revs.find((r) => !done.has(r.commitId))!;
    out.push(next);
    done.add(next.commitId);
  }
  return out;
}
