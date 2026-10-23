// Fake extension host for previewing the webview in a plain browser
// (webview/dev.html). Not used inside VS Code.
import type { HostMessage, WebviewMessage } from "../../../src/shared/protocol";
import type { ChangedFile, GraphState, Revision } from "../../../src/shared/types";
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
  { number: 12, title: "feat(graph): render revision lanes", url: "https://github.com/x/y/pull/12", headRefName: "graph-view", baseRefName: "webview", state: "OPEN", isDraft: false, checks: "passing" },
  { number: 11, title: "feat(webview): scaffold", url: "https://github.com/x/y/pull/11", headRefName: "webview", baseRefName: "main", state: "OPEN", isDraft: true, checks: "pending" },
];

let revset = "";
let lastOperation = { id: "3f2a1c8", description: "describe commit ryzxvmos", time: ago(2) };

function state(): GraphState {
  return {
    repoName: "visual-jujutsu",
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
    lastOperation,
    error: null,
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
    case "loadFiles":
      emit({ type: "files", changeId: message.changeId, files: filesOf(message.changeId) });
      break;
    case "action": {
      const a = message.action;
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
      const op =
        a.kind === "describe" ? `describe commit ${short(a.changeId)}`
        : a.kind === "moveFiles" ? `squash --from ${short(a.from)} --into ${short(a.into)}`
        : `rebase -${a.source} ${short(a.changeId)} -o ${short(a.destination!)}`;
      lastOperation = { id: Math.random().toString(16).slice(2, 9), description: op, time: new Date().toISOString() };
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
