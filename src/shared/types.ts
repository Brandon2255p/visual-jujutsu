// Types shared by the extension host and the webview. Keep this file free of
// Node and VS Code imports so the webview bundle can use it.

export interface ShortId {
  prefix: string;
  rest: string;
}

export interface Bookmark {
  name: string;
  /** More than one target means the bookmark is conflicted. */
  targets: string[];
}

export interface RemoteBookmark {
  name: string;
  remote: string;
  targets: string[];
}

export type NodeKind = "workingCopy" | "mutable" | "immutable" | "conflict" | "empty";

export interface Revision {
  changeId: string;
  commitId: string;
  short: ShortId;
  commitShort: string;
  description: string;
  authorName: string;
  authorEmail: string;
  timestamp: string;
  parents: string[];
  localBookmarks: Bookmark[];
  remoteBookmarks: RemoteBookmark[];
  tags: string[];
  isWorkingCopy: boolean;
  immutable: boolean;
  empty: boolean;
  conflict: boolean;
  divergent: boolean;
  mine: boolean;
  root: boolean;
  inTrunk: boolean;
}

/** A line segment in a row's graph gutter. Columns are lane indexes. */
export interface GraphSegment {
  fromCol: number;
  from: "top" | "center";
  toCol: number;
  to: "center" | "bottom";
  dashed?: boolean;
}

export interface GraphRow {
  changeId: string;
  col: number;
  segments: GraphSegment[];
  /** Lanes still running below this row; drawn through any expanded content. */
  lanesBelow: number[];
  elidedBelow: boolean;
}

export interface GraphLayout {
  rows: GraphRow[];
  laneCount: number;
}

export type FileStatus = "modified" | "added" | "removed" | "copied" | "renamed";

export interface ChangedFile {
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
  conflict: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  checks: "passing" | "failing" | "pending" | "none";
  review: "approved" | "changes_requested" | "review_required" | "none";
  mergedAt: string | null;
}

export interface Operation {
  id: string;
  description: string;
  time: string;
  user: string;
  current: boolean;
}

export interface RemoteBookmarkRef {
  name: string;
  remote: string;
  tracked: boolean;
}

export interface RepoInfo {
  root: string;
  name: string;
}

export interface RevsetPreset {
  name: string;
  revset: string;
}

export interface GraphState {
  repoName: string;
  root: string;
  /** All jj repos in the workspace; the graph view fills this in. */
  repos: RepoInfo[];
  jjVersion: string;
  revset: string;
  presets: RevsetPreset[];
  revisions: Revision[];
  layout: GraphLayout;
  pullRequests: PullRequest[];
  /** Every local bookmark, including ones outside the revset. */
  localBookmarks: string[];
  /** Whether PR features can work (GitHub remote found). */
  github: boolean;
  lastOperation: Operation | null;
  error: string | null;
}

export function nodeKind(rev: Revision): NodeKind {
  if (rev.isWorkingCopy) return "workingCopy";
  if (rev.conflict) return "conflict";
  if (rev.immutable) return "immutable";
  if (rev.empty) return "empty";
  return "mutable";
}

export function shortChangeId(rev: Revision): string {
  return rev.short.prefix + rev.short.rest;
}
