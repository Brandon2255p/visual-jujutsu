import type { ChangedFile, GraphState, Operation, Revision, PullRequest } from "./types";

export type RebaseSource = "r" | "s" | "b";
export type RebaseTarget = "o" | "A" | "B";
export type NewMode = "onto" | "after" | "before";

/** Everything the webview can ask the extension to do. */
export type Action =
  | { kind: "refresh" }
  | { kind: "fetch" }
  | { kind: "push" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "showCommandLog" }
  | { kind: "describe"; changeId: string; message: string }
  | { kind: "describePrompt"; changeId: string }
  | { kind: "edit"; changeId: string }
  | { kind: "new"; changeIds: string[]; mode: NewMode }
  | { kind: "abandon"; changeIds: string[] }
  | { kind: "squashIntoParent"; changeId: string }
  | { kind: "squashInto"; from: string; into?: string }
  | { kind: "moveFiles"; from: string; into: string; paths: string[] }
  | { kind: "moveFilesPrompt"; from: string; paths: string[] }
  | { kind: "openSettings" }
  | { kind: "rebase"; source: RebaseSource; changeId: string; target: RebaseTarget; destination?: string; skipEmptied?: boolean }
  | { kind: "rebaseOnTrunk"; changeId: string }
  | { kind: "openRebaseDialog"; changeId: string }
  | { kind: "createBookmark"; changeId: string }
  | { kind: "moveBookmark"; name: string; to: string }
  | { kind: "moveBookmarkHere"; changeId: string }
  | { kind: "pushBookmark"; name: string }
  | { kind: "pushChange"; changeId: string }
  | { kind: "openCreatePullRequest"; changeId: string }
  | { kind: "movePullRequestHere"; changeId: string }
  | { kind: "openPullRequest"; url: string }
  | { kind: "copy"; text: string; label: string }
  | { kind: "openDiff"; changeId: string; path: string }
  | { kind: "split"; changeId: string; paths?: string[] }
  | { kind: "absorb"; changeId: string }
  | { kind: "restoreFiles"; changeId: string; paths: string[] }
  | { kind: "reorder"; changeId: string; direction: "up" | "down" }
  | { kind: "rebaseMany"; changeIds: string[] }
  | { kind: "squashMany"; changeIds: string[] }
  | { kind: "rebaseAllOnTrunk" }
  | { kind: "renameBookmark"; changeId: string }
  | { kind: "deleteBookmark"; changeId: string }
  | { kind: "forgetBookmark"; changeId: string }
  | { kind: "trackBookmarks" }
  | { kind: "pushStack"; changeId: string }
  | { kind: "resolveConflicts"; changeId: string; path?: string }
  | { kind: "openWorkingCopyFile"; path: string }
  | { kind: "restoreOperation"; id: string; description: string }
  | { kind: "syncStack"; changeId?: string; bookmark?: string }
  | { kind: "createStackPrs"; changeId: string }
  | { kind: "cleanUpMergedPr"; number: number }
  | { kind: "switchRepo"; root: string }
  | { kind: "notSupported"; feature: string };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "setRevset"; revset: string }
  | { type: "loadFiles"; changeId: string }
  | { type: "loadOperations" }
  | { type: "action"; action: Action }
  // Dialog panels
  | { type: "rebaseSubmit"; action: Extract<Action, { kind: "rebase" }> }
  | { type: "rebasePreview"; action: Extract<Action, { kind: "rebase" }> }
  | { type: "createPrSubmit"; request: CreatePrRequest }
  | { type: "closePanel" };

export interface CreatePrRequest {
  changeId: string;
  head: string;
  createHead: boolean;
  base: string;
  title: string;
  body: string;
  draft: boolean;
}

export interface RebaseDialogData {
  revision: Revision;
  candidates: Revision[];
  defaultDestination: string | null;
}

/** What a rebase would do: the graph before and after, by change ID. */
export interface RebasePreview {
  before: Revision[];
  after: Revision[];
  /** Revisions the rebase rewrites. */
  moved: string[];
  /** Revisions that would become conflicted. */
  conflicts: string[];
}

export interface CreatePrDialogData {
  revision: Revision;
  headOptions: string[];
  suggestedHead: string;
  baseOptions: string[];
  suggestedBase: string;
  baseReason: string;
  stack: { revision: Revision; bookmark: string | null; pr: PullRequest | null }[];
}

export type HostMessage =
  | { type: "state"; state: GraphState }
  | { type: "files"; changeId: string; files: ChangedFile[] }
  | { type: "operations"; operations: Operation[] }
  | { type: "busy"; busy: boolean; label?: string }
  | { type: "init"; mode: "graph" }
  | { type: "rebaseDialog"; data: RebaseDialogData }
  | { type: "rebasePreview"; preview: RebasePreview | null; error?: string }
  | { type: "createPrDialog"; data: CreatePrDialogData };
