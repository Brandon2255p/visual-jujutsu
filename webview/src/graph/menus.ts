import type { PullRequest, Revision } from "../../../src/shared/types";
import { act, notSupported } from "../vscode";
import { shortId } from "../util";
import type { MenuEntry } from "./Menu";

interface RevisionMenuContext {
  rev: Revision;
  selection: Revision[];
  pr: PullRequest | null;
  startDescribe: (changeId: string) => void;
}

export function revisionMenu({ rev, selection, pr, startDescribe }: RevisionMenuContext): MenuEntry[] {
  const id = rev.changeId;
  if (selection.length > 1 && selection.some((r) => r.changeId === id)) {
    const ids = selection.map((r) => r.changeId);
    const n = ids.length;
    return [
      { label: `New merge revision of ${n}`, run: () => act({ kind: "new", changeIds: ids, mode: "onto" }) },
      { label: `Rebase ${n} revisions onto…`, disabled: selection.some((r) => r.immutable), run: () => act({ kind: "rebaseMany", changeIds: ids }) },
      { label: `Squash ${n} revisions into…`, disabled: selection.some((r) => r.immutable), run: () => act({ kind: "squashMany", changeIds: ids }) },
      "-",
      { label: `Abandon ${n} revisions…`, kb: "⌫", disabled: selection.some((r) => r.immutable), run: () => act({ kind: "abandon", changeIds: ids }) },
    ];
  }

  const ro = rev.immutable;
  const bookmarks = rev.localBookmarks.map((b) => b.name);
  const pushEntries: MenuEntry[] = [
    ...(bookmarks.length
      ? bookmarks.map((name) => ({ label: `Push bookmark “${name}”`, run: () => act({ kind: "pushBookmark", name }) }))
      : [{ label: "Push (create bookmark)", disabled: ro, run: () => act({ kind: "pushChange", changeId: id }) }]),
    { label: "Push stack…", disabled: ro, run: () => act({ kind: "pushStack", changeId: id }) },
  ];

  return [
    { label: "Describe…", kb: "Enter", disabled: ro, run: () => startDescribe(id) },
    { label: "Edit (check out)", kb: "E", disabled: ro || rev.isWorkingCopy, run: () => act({ kind: "edit", changeId: id }) },
    {
      label: "New revision",
      children: [
        { label: "On top", kb: "N", run: () => act({ kind: "new", changeIds: [id], mode: "onto" }) },
        { label: "Insert after", kb: "-A", run: () => act({ kind: "new", changeIds: [id], mode: "after" }) },
        { label: "Insert before", kb: "-B", disabled: ro, run: () => act({ kind: "new", changeIds: [id], mode: "before" }) },
      ],
    },
    "-",
    {
      label: "Rebase",
      disabled: ro,
      children: [
        { label: "This revision only…", kb: "-r", run: () => act({ kind: "rebase", source: "r", changeId: id, target: "o" }) },
        { label: "With descendants…", kb: "-s", run: () => act({ kind: "rebase", source: "s", changeId: id, target: "o" }) },
        { label: "Whole branch…", kb: "-b", run: () => act({ kind: "rebase", source: "b", changeId: id, target: "o" }) },
        "-",
        { label: "Insert after…", kb: "-A", run: () => act({ kind: "rebase", source: "r", changeId: id, target: "A" }) },
        { label: "Insert before…", kb: "-B", run: () => act({ kind: "rebase", source: "r", changeId: id, target: "B" }) },
        "-",
        { label: "Open rebase dialog…", kb: "R", run: () => act({ kind: "openRebaseDialog", changeId: id }) },
      ],
    },
    { label: "Rebase on main", disabled: ro, run: () => act({ kind: "rebaseOnTrunk", changeId: id }) },
    { label: "Squash into parent", kb: "S", disabled: ro, run: () => act({ kind: "squashIntoParent", changeId: id }) },
    { label: "Squash into…", disabled: ro, run: () => act({ kind: "squashInto", from: id }) },
    { label: "Split…", disabled: ro || rev.empty, run: () => act({ kind: "split", changeId: id }) },
    { label: "Absorb into stack", disabled: ro || rev.empty, run: () => act({ kind: "absorb", changeId: id }) },
    { label: "Move up", kb: "⌥↑", disabled: ro, run: () => act({ kind: "reorder", changeId: id, direction: "up" }) },
    { label: "Move down", kb: "⌥↓", disabled: ro, run: () => act({ kind: "reorder", changeId: id, direction: "down" }) },
    ...(rev.conflict ? [{ label: "Resolve conflicts…", run: () => act({ kind: "resolveConflicts", changeId: id }) }] : []),
    { label: "Duplicate", run: () => notSupported("Duplicate revision") },
    "-",
    {
      label: "Bookmark",
      children: [
        { label: "Create bookmark…", run: () => act({ kind: "createBookmark", changeId: id }) },
        { label: "Move bookmark here…", run: () => act({ kind: "moveBookmarkHere", changeId: id }) },
        "-",
        { label: "Rename…", disabled: !bookmarks.length, run: () => act({ kind: "renameBookmark", changeId: id }) },
        { label: "Delete…", disabled: !bookmarks.length, run: () => act({ kind: "deleteBookmark", changeId: id }) },
        { label: "Forget (local only)…", disabled: !bookmarks.length, run: () => act({ kind: "forgetBookmark", changeId: id }) },
        { label: "Track / untrack remote…", run: () => act({ kind: "trackBookmarks" }) },
        { label: "Advance closest bookmark here", run: () => notSupported("Advance bookmark") },
      ],
    },
    ...pushEntries,
    { label: "Create pull request…", disabled: ro, run: () => act({ kind: "openCreatePullRequest", changeId: id }) },
    { label: "Move pull request here…", disabled: ro, run: () => act({ kind: "movePullRequestHere", changeId: id }) },
    ...(pr ? [{ label: `Open PR #${pr.number} on GitHub`, run: () => act({ kind: "openPullRequest", url: pr.url }) }] : []),
    "-",
    { label: "Copy change ID", kb: "⌘C", run: () => act({ kind: "copy", text: rev.changeId, label: `change ID ${shortId(rev)}` }) },
    { label: "Copy commit ID", run: () => act({ kind: "copy", text: rev.commitId, label: `commit ID ${rev.commitShort}` }) },
    { label: "Show evolution log", run: () => notSupported("Evolution log") },
    "-",
    { label: "Abandon…", kb: "⌫", disabled: ro, run: () => act({ kind: "abandon", changeIds: [id] }) },
  ];
}

export function fileMenu(
  rev: Revision,
  paths: string[],
  parent: Revision | undefined,
  conflicted: boolean,
  openDiff: () => void,
): MenuEntry[] {
  const n = paths.length;
  const what = n === 1 ? "file" : `${n} files`;
  return [
    { label: "Open diff", disabled: n !== 1, run: openDiff },
    { label: `Move ${what} to revision…`, disabled: rev.immutable, run: () => act({ kind: "moveFilesPrompt", from: rev.changeId, paths }) },
    {
      label: `Move ${what} into parent`,
      disabled: rev.immutable || !parent || parent.immutable,
      run: () => parent && act({ kind: "moveFiles", from: rev.changeId, into: parent.changeId, paths }),
    },
    { label: `Split ${what} into a separate revision`, disabled: rev.immutable, run: () => act({ kind: "split", changeId: rev.changeId, paths }) },
    { label: `Discard changes to ${what}`, disabled: rev.immutable, run: () => act({ kind: "restoreFiles", changeId: rev.changeId, paths }) },
    ...(conflicted && n === 1 ? [{ label: "Resolve with merge tool…", run: () => act({ kind: "resolveConflicts", changeId: rev.changeId, path: paths[0] }) }] : []),
    ...(rev.isWorkingCopy && n === 1 ? [{ label: "Open file", run: () => act({ kind: "openWorkingCopyFile", path: paths[0] }) }] : []),
    "-",
    { label: "Copy path", disabled: n !== 1, run: () => act({ kind: "copy", text: paths[0], label: "path" }) },
  ];
}
