// Fake extension host for previewing the webview in a plain browser
// (webview/dev.html). Not used inside VS Code.
import type { HostMessage, WebviewMessage } from "../../../src/shared/protocol";
import type { GraphState, Revision } from "../../../src/shared/types";
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
    lastOperation: { id: "3f2a1c8", description: "describe commit ryzxvmos", time: ago(2) },
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
      emit({
        type: "files",
        changeId: message.changeId,
        files: [
          { path: "src/webview/graph.ts", status: "modified", added: 142, removed: 18, conflict: false },
          { path: "src/webview/lanes.ts", status: "added", added: 88, removed: 0, conflict: false },
          { path: "package.json", status: "modified", added: 3, removed: 1, conflict: false },
        ],
      });
      break;
    case "action":
      if (message.action.kind === "describe") {
        const { changeId, message: text } = message.action;
        revisions = revisions.map((r) => (r.changeId === changeId ? { ...r, description: text + "\n" } : r));
        emit({ type: "state", state: state() });
      }
      break;
  }
}
