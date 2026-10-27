import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ChangedFile, EvologEntry, FileView, GraphRow, GraphState, Operation, PullRequest, Revision } from "../../../src/shared/types";
import { nodeKind } from "../../../src/shared/types";
import { activeLine } from "../../../src/shared/graph";
import { buildFileTree, filesIn, folderPaths, type FileTreeDir } from "../../../src/shared/fileTree";
import type { RebaseSource, RebaseTarget } from "../../../src/shared/protocol";
import { Icon } from "../icons";
import { act, notSupported, onMessage, post } from "../vscode";
import { cls, firstLine, relativeTime, shortId, splitPath } from "../util";
import { Gutter, ROW_HEIGHT, gutterWidth } from "./Gutter";
import { Menu, MenuEntry } from "./Menu";
import { fileMenu, revisionMenu } from "./menus";
import { EvoLog, EvologTarget } from "./EvoLog";
import { OpLog } from "./OpLog";
import { PullRequests } from "./PullRequests";
import { FileTree } from "./FileTree";
import { ChangeId } from "../ChangeId";

type Drag =
  | { kind: "rev"; changeId: string }
  | { kind: "files"; from: string; paths: string[] }
  | { kind: "bookmark"; name: string };

type Zone = "before" | "onto" | "after";

interface DropTarget {
  changeId: string;
  zone: Zone;
  alt: boolean;
  shift: boolean;
}

const fileKey = (changeId: string, path: string) => `${changeId}\0${path}`;

export function GraphView() {
  const [state, setState] = useState<GraphState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<Map<string, ChangedFile[]>>(new Map());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  /** Collapsed folders in the folder view, as fileKey(changeId, folder path). */
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [revsetDraft, setRevsetDraft] = useState("");
  const [view, setView] = useState<"graph" | "prs" | "oplog" | "evolog">("graph");
  const [operations, setOperations] = useState<Operation[] | null>(null);
  const [evolog, setEvolog] = useState<{ target: EvologTarget; entries: EvologEntry[] | null; error: string | null } | null>(null);
  const evologRef = useRef(evolog);
  evologRef.current = evolog;
  const viewRef = useRef(view);
  viewRef.current = view;
  const listRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  useEffect(() => {
    const off = onMessage((m) => {
      if (m.type === "state") {
        setState(m.state);
        setRevsetDraft(m.state.revset);
        // File lists may be stale after any change; reload the open ones.
        const ids = new Set(m.state.revisions.map((r) => r.changeId));
        setExpanded((prev) => new Set([...prev].filter((id) => ids.has(id))));
        setSelected((prev) => prev.filter((id) => ids.has(id)));
        for (const id of expandedRef.current) if (ids.has(id)) post({ type: "loadFiles", changeId: id });
        if (viewRef.current === "oplog") post({ type: "loadOperations" });
        const evo = evologRef.current;
        if (viewRef.current === "evolog" && evo) post({ type: "loadEvolog", changeId: evo.target.changeId });
      } else if (m.type === "operations") {
        setOperations(m.operations);
      } else if (m.type === "evolog") {
        setEvolog((prev) => (prev && prev.target.changeId === m.changeId ? { ...prev, entries: m.entries, error: m.error ?? null } : prev));
      } else if (m.type === "files") {
        setFiles((prev) => new Map(prev).set(m.changeId, m.files));
      } else if (m.type === "busy") {
        setBusy(m.busy ? (m.label ?? "Working…") : null);
      }
    });
    post({ type: "ready" });
    return () => void off();
  }, []);

  // On <html> so the CSS variables reach menus and every view.
  useEffect(() => {
    document.documentElement.classList.toggle("density-compact", state?.density === "compact");
  }, [state?.density]);

  const revisions = state?.revisions ?? [];
  const byId = useMemo(() => new Map(revisions.map((r) => [r.changeId, r])), [revisions]);
  const byCommit = useMemo(() => new Map(revisions.map((r) => [r.commitId, r])), [revisions]);
  const active = useMemo(() => activeLine(revisions), [revisions]);
  const rows = useMemo(() => new Map(state?.layout.rows.map((r) => [r.changeId, r]) ?? []), [state]);
  const prByBookmark = useMemo(() => {
    const m = new Map<string, PullRequest>();
    for (const pr of [...(state?.pullRequests ?? [])].sort((a, b) => a.number - b.number)) {
      const cur = m.get(pr.headRefName);
      if (!cur || pr.state === "OPEN" || cur.state !== "OPEN") m.set(pr.headRefName, pr);
    }
    return m;
  }, [state]);
  const remoteTargets = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of revisions) for (const rb of r.remoteBookmarks) for (const t of rb.targets) {
      if (!m.has(rb.name)) m.set(rb.name, new Set());
      m.get(rb.name)!.add(t);
    }
    return m;
  }, [revisions]);

  const prFor = (rev: Revision) => {
    for (const b of rev.localBookmarks) {
      const pr = prByBookmark.get(b.name);
      if (pr) return pr;
    }
    return null;
  };

  const toggleExpanded = (id: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const willOpen = open ?? !next.has(id);
      if (willOpen) {
        next.add(id);
        post({ type: "loadFiles", changeId: id });
      } else next.delete(id);
      return next;
    });
    // Folders start expanded each time a revision's files are shown.
    setCollapsedDirs((prev) => new Set([...prev].filter((k) => !k.startsWith(id + "\0"))));
  };

  const toggleDir = (changeId: string, dir: string) =>
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      const k = fileKey(changeId, dir);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  /** Every folder in the open revisions' file lists, for collapse all. */
  const openFolders = () =>
    [...expanded].flatMap((id) => folderPaths(buildFileTree(files.get(id) ?? [])).map((dir) => fileKey(id, dir)));

  const selectRow = (id: string, e: MouseEvent | KeyboardEvent | null) => {
    if (e && (e.metaKey || e.ctrlKey)) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else if (e && e.shiftKey && selected.length) {
      const order = revisions.map((r) => r.changeId);
      const a = order.indexOf(selected[selected.length - 1]);
      const b = order.indexOf(id);
      setSelected(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else {
      setSelected([id]);
    }
  };

  const startDescribe = (id: string) => {
    setSelected([id]);
    setEditing(id);
  };

  const showEvolog = (rev: Revision) => {
    setEvolog({ target: { changeId: rev.changeId, label: shortId(rev) }, entries: null, error: null });
    setView("evolog");
    post({ type: "loadEvolog", changeId: rev.changeId });
  };

  const openRevisionMenu = (rev: Revision, x: number, y: number) => {
    if (!selected.includes(rev.changeId)) setSelected([rev.changeId]);
    const selection = selected.includes(rev.changeId) ? selected.map((id) => byId.get(id)!).filter(Boolean) : [rev];
    setMenu({ x, y, entries: revisionMenu({ rev, selection, pr: prFor(rev), startDescribe, showEvolog }) });
  };

  const openMenu = (x: number, y: number, entries: MenuEntry[]) => setMenu({ x, y, entries });
  const divergent = revisions.filter((r) => r.divergent && !r.immutable);

  // ---- Keyboard ------------------------------------------------------------

  const onListKey = (e: KeyboardEvent) => {
    if (editing || menu) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      act({ kind: e.shiftKey ? "redo" : "undo" });
      e.preventDefault();
      return;
    }
    const cur = byId.get(selected[selected.length - 1] ?? "");
    const order = revisions.map((r) => r.changeId);
    const i = cur ? order.indexOf(cur.changeId) : -1;
    const move = (to: number) => {
      const id = order[Math.max(0, Math.min(order.length - 1, to))];
      if (!id) return;
      setSelected([id]);
      listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
    };
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (cur && !cur.immutable) act({ kind: "reorder", changeId: cur.changeId, direction: e.key === "ArrowUp" ? "up" : "down" });
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        move(i + 1);
        break;
      case "ArrowUp":
        move(i < 0 ? 0 : i - 1);
        break;
      case "ArrowRight":
        if (cur) toggleExpanded(cur.changeId, true);
        break;
      case "ArrowLeft":
        if (cur) toggleExpanded(cur.changeId, false);
        break;
      case "Enter":
      case "F2":
        if (cur && !cur.immutable) startDescribe(cur.changeId);
        break;
      case "Backspace":
      case "Delete":
        if (selected.length && selected.every((id) => !byId.get(id)?.immutable)) act({ kind: "abandon", changeIds: selected });
        break;
      case "n":
        if (cur) act({ kind: "new", changeIds: selected.length > 1 ? selected : [cur.changeId], mode: "onto" });
        break;
      case "e":
        if (cur && !cur.immutable) act({ kind: "edit", changeId: cur.changeId });
        break;
      case "s":
        if (cur && !cur.immutable) act({ kind: "squashIntoParent", changeId: cur.changeId });
        break;
      case "r":
        if (cur && !cur.immutable) act({ kind: "openRebaseDialog", changeId: cur.changeId });
        break;
      case "c":
        if (cur && mod) act({ kind: "copy", text: cur.changeId, label: `change ID ${shortId(cur)}` });
        else return;
        break;
      case "ContextMenu":
        if (cur) {
          const el = listRef.current?.querySelector(`[data-id="${cur.changeId}"]`)?.getBoundingClientRect();
          openRevisionMenu(cur, el ? el.left + 60 : 60, el ? el.bottom : 60);
        }
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // ---- Drag and drop -------------------------------------------------------

  const zoneFor = (e: DragEvent, el: HTMLElement): Zone => {
    if (drag?.kind !== "rev") return "onto";
    const r = el.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (y < r.height * 0.25) return "before";
    if (y > r.height * 0.75) return "after";
    return "onto";
  };

  const canDrop = (target: Revision) => {
    if (!drag) return false;
    if (drag.kind === "rev") return drag.changeId !== target.changeId;
    if (drag.kind === "files") return drag.from !== target.changeId && !target.immutable;
    return true;
  };

  const rebaseFlags = (d: DropTarget): { source: RebaseSource; target: RebaseTarget } => ({
    source: d.alt ? "r" : d.shift ? "b" : "s",
    target: d.zone === "before" ? "B" : d.zone === "after" ? "A" : "o",
  });

  const finishDrop = (target: Revision, d: DropTarget) => {
    if (!drag || !canDrop(target)) return;
    if (drag.kind === "rev") {
      const { source, target: where } = rebaseFlags(d);
      act({ kind: "rebase", source, changeId: drag.changeId, target: where, destination: target.changeId });
    } else if (drag.kind === "files") {
      act({ kind: "moveFiles", from: drag.from, into: target.changeId, paths: drag.paths });
      setSelectedFiles(new Set());
    } else {
      act({ kind: "moveBookmark", name: drag.name, to: target.changeId });
    }
  };

  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  const dropHint = () => {
    if (!drag) return null;
    const target = drop ? byId.get(drop.changeId) : undefined;
    const label = (r: Revision | undefined) => (r ? shortId(r) : "…");
    if (drag.kind === "files") {
      const src = byId.get(drag.from);
      const n = drag.paths.length;
      return {
        title: `Move ${n === 1 ? splitPath(drag.paths[0]).name : `${n} files`} into ${label(target)}`,
        cmd: `jj squash --from ${label(src)} --into ${label(target)} ${drag.paths.join(" ")}`,
        keys: null,
      };
    }
    if (drag.kind === "bookmark") {
      return { title: `Move bookmark “${drag.name}” to ${label(target)}`, cmd: `jj bookmark set ${drag.name} -r ${label(target)}`, keys: null };
    }
    const src = byId.get(drag.changeId);
    const d = drop ?? { changeId: "", zone: "onto" as Zone, alt: false, shift: false };
    const { source, target: where } = rebaseFlags(d);
    const what = source === "r" ? label(src) : source === "s" ? `${label(src)} and descendants` : `the branch of ${label(src)}`;
    const how = where === "o" ? "onto" : where === "A" ? "after" : "before";
    return {
      title: `Rebase ${what} ${how} ${label(target)}`,
      cmd: `jj rebase -${source} ${label(src)} -${where} ${label(target)}`,
      keys: { source, where },
    };
  };

  // ---- Render --------------------------------------------------------------

  if (!state) {
    return (
      <div class="panel">
        <div class="progress" />
        <div class="empty-state">Loading revisions…</div>
      </div>
    );
  }

  const laneCount = state.layout.laneCount;
  const gutterW = gutterWidth(laneCount);
  const rowHeight = ROW_HEIGHT[state.density];
  const presetMatch = state.presets.find((p) => p.revset === state.revset);
  const mine = state.presets.find((p) => p.name === "Mine");
  const hint = dropHint();

  return (
    <div class="panel" onContextMenu={(e) => e.preventDefault()}>
      {busy && <div class="progress" title={busy} />}
      {state.repos.length > 1 && (
        <div class="repo-row">
          <span class="repo-label">Repository</span>
          <select
            class="select"
            title="Switch repository"
            value={state.root}
            onChange={(e) => act({ kind: "switchRepo", root: (e.currentTarget as HTMLSelectElement).value })}
          >
            {state.repos.map((r) => (
              <option value={r.root}>{r.name}</option>
            ))}
          </select>
        </div>
      )}
      <div class="toolbar">
        <button class="btn btn-secondary" onClick={() => act({ kind: "fetch" })} title="jj git fetch">
          <Icon name="fetch" /> Fetch
        </button>
        <button class="btn btn-secondary" onClick={() => act({ kind: "push" })} title="Push bookmarks">
          <Icon name="push" /> Push
        </button>
        <button class="icon-btn" title="Settings" onClick={() => act({ kind: "openSettings" })}>
          <Icon name="settings" />
        </button>
        <div class="spacer" />
        <button class="icon-btn" title="Undo last operation (⌘Z)" onClick={() => act({ kind: "undo" })}>
          <Icon name="undo" />
        </button>
        <button class="icon-btn" title="Redo (⇧⌘Z)" onClick={() => act({ kind: "redo" })}>
          <Icon name="redo" />
        </button>
        <button class="icon-btn" title="Refresh" onClick={() => act({ kind: "refresh" })}>
          <Icon name="refresh" />
        </button>
        <button
          class="icon-btn"
          title="More actions"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({
              x: r.left,
              y: r.bottom + 2,
              entries: [
                { label: "Push all tracked bookmarks", run: () => act({ kind: "push" }) },
                { label: "Rebase all my stacks on main", run: () => act({ kind: "rebaseAllOnTrunk" }) },
                { label: "Track / untrack remote bookmarks…", run: () => act({ kind: "trackBookmarks" }) },
                "-",
                {
                  label: "Operation log",
                  run: () => {
                    setView("oplog");
                    post({ type: "loadOperations" });
                  },
                },
                { label: "Show command log", run: () => act({ kind: "showCommandLog" }) },
                "-",
                {
                  label: "Density",
                  children: (["comfortable", "compact"] as const).map((d) => ({
                    label: d === "comfortable" ? "Comfortable" : "Compact",
                    checked: state.density === d,
                    run: () => act({ kind: "setDensity", density: d }),
                  })),
                },
                {
                  label: "Show files as",
                  children: (["list", "folders"] as const).map((v) => ({
                    label: v === "list" ? "List" : "Folders",
                    checked: state.fileView === v,
                    run: () => act({ kind: "setFileView", fileView: v }),
                  })),
                },
                { label: "Settings", run: () => act({ kind: "openSettings" }) },
              ],
            });
          }}
        >
          <Icon name="more" />
        </button>
      </div>

      <div class="views">
        <div class="segmented">
          <button class={cls("icon-btn", view === "graph" && "active")} title="Revision graph" onClick={() => setView("graph")}>
            <Icon name="graph" />
          </button>
          <button class={cls("icon-btn", view === "prs" && "active")} title="Pull requests" onClick={() => setView("prs")}>
            <Icon name="pull-request" />
          </button>
          <button
            class={cls("icon-btn", view === "oplog" && "active")}
            title="Operation log"
            onClick={() => {
              setView("oplog");
              post({ type: "loadOperations" });
            }}
          >
            <Icon name="history" />
          </button>
        </div>
        <div class="spacer" />
        {view === "graph" && (
          <>
            <select
              class="select"
              title="Revset preset"
              value={presetMatch ? presetMatch.name : "__custom"}
              onChange={(e) => {
                const p = state.presets.find((x) => x.name === (e.currentTarget as HTMLSelectElement).value);
                if (p) post({ type: "setRevset", revset: p.revset });
              }}
            >
              {state.presets.map((p) => (
                <option value={p.name}>{p.name}</option>
              ))}
              {!presetMatch && <option value="__custom">Custom</option>}
            </select>
            {state.fileView === "folders" && <CollapseAllButton folders={openFolders()} collapsed={collapsedDirs} onChange={setCollapsedDirs} />}
            {mine && (
              <button
                class={cls("icon-btn", state.revset === mine.revset && "active")}
                title="Only my revisions"
                onClick={() => post({ type: "setRevset", revset: state.revset === mine.revset ? "" : mine.revset })}
              >
                <Icon name="person" />
              </button>
            )}
          </>
        )}
      </div>

      {view === "oplog" && <OpLog operations={operations} />}
      {view === "evolog" && evolog && (
        <EvoLog target={evolog.target} entries={evolog.entries} error={evolog.error} files={files} fileView={state.fileView} onBack={() => setView("graph")} />
      )}
      {view === "prs" && <PullRequests state={state} openMenu={openMenu} />}

      {view === "graph" && (
        <>
          <div class="revset">
            <div class="input-wrap" title="Revset. Press Enter to apply.">
              <Icon name="filter" />
              <input
                value={revsetDraft}
                placeholder="jj default (revsets.log)"
                spellcheck={false}
                onInput={(e) => setRevsetDraft((e.currentTarget as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") post({ type: "setRevset", revset: revsetDraft });
                  if (e.key === "Escape") setRevsetDraft(state.revset);
                }}
              />
            </div>
          </div>

          {state.error && (
            <div class="banner">
              <Icon name="x-circle" />
              <span>{state.error.trim()}</span>
            </div>
          )}

          {divergent.length > 0 && <DivergenceBanner revisions={divergent} onCompare={showEvolog} />}

          <div class="graph" ref={listRef} tabIndex={0} onKeyDown={onListKey}>
            {revisions.length === 0 && !state.error && <div class="empty-state">No revisions match this revset.</div>}
            {revisions.map((rev) => {
              const row = rows.get(rev.changeId);
              if (!row) return null;
              return (
                <RevisionBlock
                  key={rev.changeId}
                  rev={rev}
                  row={row}
                  laneCount={laneCount}
                  rowHeight={rowHeight}
                  active={active.has(rev.changeId)}
                  gutterW={gutterW}
                  selected={selected.includes(rev.changeId)}
                  expanded={expanded.has(rev.changeId)}
                  editing={editing === rev.changeId}
                  files={files.get(rev.changeId)}
                  fileView={state.fileView}
                  isDirCollapsed={(dir) => collapsedDirs.has(fileKey(rev.changeId, dir))}
                  onToggleDir={(dir) => toggleDir(rev.changeId, dir)}
                  selectedFiles={selectedFiles}
                  pr={prFor(rev)}
                  remoteTargets={remoteTargets}
                  parent={byCommit.get(rev.parents[0])}
                  drag={drag}
                  drop={drop?.changeId === rev.changeId ? drop : null}
                  canDrop={canDrop(rev)}
                  onClick={(e) => {
                    listRef.current?.focus();
                    selectRow(rev.changeId, e);
                    if (!e.metaKey && !e.ctrlKey && !e.shiftKey) toggleExpanded(rev.changeId);
                  }}
                  onDblClick={() => !rev.immutable && startDescribe(rev.changeId)}
                  onMenu={(x, y) => openRevisionMenu(rev, x, y)}
                  onSaveDescription={(message) => {
                    setEditing(null);
                    if (message !== rev.description.trimEnd()) act({ kind: "describe", changeId: rev.changeId, message });
                    listRef.current?.focus();
                  }}
                  onCancelEdit={() => {
                    setEditing(null);
                    listRef.current?.focus();
                  }}
                  onFileClick={(path, e) => {
                    const k = fileKey(rev.changeId, path);
                    if (e.metaKey || e.ctrlKey) {
                      setSelectedFiles((prev) => {
                        const next = new Set([...prev].filter((x) => x.startsWith(rev.changeId + "\0")));
                        if (next.has(k)) next.delete(k);
                        else next.add(k);
                        return next;
                      });
                    } else {
                      setSelectedFiles(new Set([k]));
                      act({ kind: "openDiff", changeId: rev.changeId, path });
                    }
                  }}
                  onFileMenu={(path, x, y, folder) => {
                    const k = fileKey(rev.changeId, path);
                    // A folder acts on every file in it; a file on the selection it belongs to.
                    const paths = folder
                      ? folder
                      : selectedFiles.has(k)
                        ? [...selectedFiles].filter((s) => s.startsWith(rev.changeId + "\0")).map((s) => s.split("\0")[1])
                        : [path];
                    if (folder) setSelectedFiles(new Set(folder.map((p) => fileKey(rev.changeId, p))));
                    else if (!selectedFiles.has(k)) setSelectedFiles(new Set([k]));
                    setMenu({
                      x,
                      y,
                      entries: fileMenu(
                        rev,
                        paths,
                        byCommit.get(rev.parents[0]),
                        (files.get(rev.changeId) ?? []).some((f) => f.conflict && paths.includes(f.path)),
                        () => act({ kind: "openDiff", changeId: rev.changeId, path }),
                      ),
                    });
                  }}
                  onDragStart={(d) => setDrag(d)}
                  onDragOver={(e, el) => {
                    if (!canDrop(rev)) return;
                    e.preventDefault();
                    const next = { changeId: rev.changeId, zone: zoneFor(e, el), alt: e.altKey, shift: e.shiftKey };
                    if (!drop || drop.changeId !== next.changeId || drop.zone !== next.zone || drop.alt !== next.alt || drop.shift !== next.shift) setDrop(next);
                  }}
                  onDrop={(e, el) => {
                    e.preventDefault();
                    finishDrop(rev, { changeId: rev.changeId, zone: zoneFor(e, el), alt: e.altKey, shift: e.shiftKey });
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                />
              );
            })}
          </div>

          {hint && (
            <div class="drop-hint">
              <div class="title">{hint.title}</div>
              <div class="cmd">{hint.cmd}</div>
              {hint.keys && (
                <div class="keys">
                  <div class={hint.keys.source === "s" ? "on-text" : ""}>
                    <span class={cls("key", hint.keys.source === "s" && "on")}>drag</span> With descendants (-s)
                  </div>
                  <div class={hint.keys.source === "r" ? "on-text" : ""}>
                    <span class={cls("key", hint.keys.source === "r" && "on")}>⌥</span> This revision only (-r)
                  </div>
                  <div class={hint.keys.source === "b" ? "on-text" : ""}>
                    <span class={cls("key", hint.keys.source === "b" && "on")}>⇧</span> Whole branch (-b)
                  </div>
                  <div class={hint.keys.where !== "o" ? "on-text" : ""}>
                    <span class={cls("key", hint.keys.where !== "o" && "on")}>top / bottom edge</span> Insert before (-B) / after (-A)
                  </div>
                </div>
              )}
              <div class="hint">Release to apply · Esc to cancel · ⌘Z to undo</div>
            </div>
          )}

        </>
      )}

      <div class="footer">
        <Icon name="terminal" />
        <span class="grow">
          jj {state.jjVersion}
          {state.lastOperation && ` · last op: ${firstLine(state.lastOperation.description)} ${relativeTime(state.lastOperation.time)}`}
        </span>
        <button class="link" onClick={() => act({ kind: "showCommandLog" })}>
          Show commands
        </button>
      </div>

      {menu && <Menu entries={menu.entries} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  );
}

interface BlockProps {
  rev: Revision;
  row: GraphRow;
  laneCount: number;
  rowHeight: number;
  active: boolean;
  gutterW: number;
  selected: boolean;
  expanded: boolean;
  editing: boolean;
  files: ChangedFile[] | undefined;
  fileView: FileView;
  isDirCollapsed: (dir: string) => boolean;
  onToggleDir: (dir: string) => void;
  selectedFiles: Set<string>;
  pr: PullRequest | null;
  remoteTargets: Map<string, Set<string>>;
  parent: Revision | undefined;
  drag: Drag | null;
  drop: DropTarget | null;
  canDrop: boolean;
  onClick: (e: MouseEvent) => void;
  onDblClick: () => void;
  onMenu: (x: number, y: number) => void;
  onSaveDescription: (message: string) => void;
  onCancelEdit: () => void;
  onFileClick: (path: string, e: MouseEvent) => void;
  /** folder: every path in the right-clicked folder. */
  onFileMenu: (path: string, x: number, y: number, folder?: string[]) => void;
  onDragStart: (d: Drag) => void;
  onDragOver: (e: DragEvent, el: HTMLElement) => void;
  onDrop: (e: DragEvent, el: HTMLElement) => void;
  onDragEnd: () => void;
}

function RevisionBlock(p: BlockProps) {
  const { rev } = p;
  const kind = nodeKind(rev);
  const desc = firstLine(rev.description);
  const isDragSource =
    (p.drag?.kind === "rev" && p.drag.changeId === rev.changeId) || (p.drag?.kind === "files" && p.drag.from === rev.changeId);

  const startDrag = (e: DragEvent, d: Drag, label: string) => {
    e.stopPropagation();
    e.dataTransfer?.setData("text/plain", label);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    p.onDragStart(d);
  };

  return (
    <div class="block" data-id={rev.changeId}>
      <Gutter row={p.row} laneCount={p.laneCount} kind={kind} active={p.active} height={p.rowHeight} />
      <div
        class={cls(
          "row",
          p.selected && "selected",
          p.drop && p.canDrop && p.drop.zone === "onto" && "drop-target",
          p.drop && p.canDrop && p.drop.zone === "before" && "drop-before",
          p.drop && p.canDrop && p.drop.zone === "after" && "drop-after",
          isDragSource && "dragging",
        )}
        style={{ paddingLeft: `${p.gutterW}px` }}
        title={`${rev.authorName} <${rev.authorEmail}>\n${rev.commitShort}${rev.description ? "\n\n" + rev.description.trim() : ""}`}
        draggable={!rev.immutable}
        onDragStart={(e) => startDrag(e, { kind: "rev", changeId: rev.changeId }, rev.changeId)}
        onDragEnd={p.onDragEnd}
        onDragOver={(e) => p.onDragOver(e, e.currentTarget as HTMLElement)}
        onDrop={(e) => p.onDrop(e, e.currentTarget as HTMLElement)}
        onClick={p.onClick}
        onDblClick={p.onDblClick}
        onContextMenu={(e) => {
          e.preventDefault();
          p.onMenu(e.clientX, e.clientY);
        }}
      >
        <ChangeId rev={rev} />
        <Chips rev={rev} remoteTargets={p.remoteTargets} onDragBookmark={(e, name) => startDrag(e, { kind: "bookmark", name }, name)} />
        <span class={cls("desc", !desc && "muted")}>
          {rev.empty && desc ? <span class="muted">(empty) </span> : null}
          {desc || (rev.empty ? "(empty) (no description set)" : "(no description set)")}
        </span>
        {p.pr && (
          <span
            class={cls("pr", `pr-${p.pr.isDraft && p.pr.state === "OPEN" ? "draft" : p.pr.state.toLowerCase()}`)}
            title={`${p.pr.title} (${[p.pr.isDraft ? "draft" : p.pr.state.toLowerCase(), p.pr.review !== "none" && p.pr.review.replace("_", " ")].filter(Boolean).join(", ")})`}
            onClick={(e) => {
              e.stopPropagation();
              act({ kind: "openPullRequest", url: p.pr!.url });
            }}
          >
            <Icon name="pull-request" />#{p.pr.number}
          </span>
        )}
        {p.pr && p.pr.checks !== "none" && (
          <span title={`Checks ${p.pr.checks}`}>
            <Icon name={p.pr.checks === "passing" ? "check" : p.pr.checks === "failing" ? "x-circle" : "clock"} class={`check check-${p.pr.checks}`} />
          </span>
        )}
        <span class="time">{relativeTime(rev.timestamp)}</span>
        <span class="actions">
          {!rev.immutable && (
            <button class="icon-btn sm" title="Describe" onClick={(e) => (e.stopPropagation(), p.onDblClick())}>
              <Icon name="edit" />
            </button>
          )}
          <button
            class="icon-btn sm"
            title="New revision on top"
            onClick={(e) => {
              e.stopPropagation();
              act({ kind: "new", changeIds: [rev.changeId], mode: "onto" });
            }}
          >
            <Icon name="plus" />
          </button>
          <button
            class="icon-btn sm"
            title="More actions"
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              p.onMenu(r.left, r.bottom);
            }}
          >
            <Icon name="more" />
          </button>
        </span>
      </div>

      {p.editing && <DescribeEditor rev={rev} indent={p.gutterW} onSave={p.onSaveDescription} onCancel={p.onCancelEdit} />}

      {p.expanded && (
        <div class="files">
          {!p.files && (
            <div class="note" style={{ paddingLeft: `${p.gutterW}px` }}>
              Loading files…
            </div>
          )}
          {p.files?.length === 0 && (
            <div class="note" style={{ paddingLeft: `${p.gutterW}px` }}>
              No changes
            </div>
          )}
          {p.files && (
            <FileTree
              files={p.files}
              view={p.fileView}
              indent={p.gutterW - 14}
              grip
              isCollapsed={p.isDirCollapsed}
              onToggle={p.onToggleDir}
              folderProps={(dir: FileTreeDir) => {
                const paths = filesIn(dir).map((f) => f.path);
                return {
                  draggable: !rev.immutable,
                  onDragStart: (e: DragEvent) => startDrag(e, { kind: "files", from: rev.changeId, paths }, paths.join("\n")),
                  onDragEnd: p.onDragEnd,
                  onContextMenu: (e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    p.onFileMenu(paths[0], e.clientX, e.clientY, paths);
                  },
                };
              }}
              renderFile={(f, name, dir, indent, guides) => {
                const key = fileKey(rev.changeId, f.path);
                const sel = p.selectedFiles.has(key);
                const draggingThis = p.drag?.kind === "files" && p.drag.from === rev.changeId && p.drag.paths.includes(f.path);
                return (
                  <div
                    key={f.path}
                    class={cls("file", sel && "selected", draggingThis && "dragging")}
                    style={{ paddingLeft: `${indent}px` }}
                    draggable={!rev.immutable}
                    title={f.path}
                    onDragStart={(e) => {
                      const paths = sel
                        ? [...p.selectedFiles].filter((s) => s.startsWith(rev.changeId + "\0")).map((s) => s.split("\0")[1])
                        : [f.path];
                      startDrag(e, { kind: "files", from: rev.changeId, paths }, paths.join("\n"));
                    }}
                    onDragEnd={p.onDragEnd}
                    onClick={(e) => p.onFileClick(f.path, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      p.onFileMenu(f.path, e.clientX, e.clientY);
                    }}
                  >
                    {guides}
                    <Icon name="grip" class="grip" />
                    <Icon name="file" />
                    <span>{name}</span>
                    <span class="dir">{dir}</span>
                    <span class="add">+{f.added}</span>
                    <span class="del">−{f.removed}</span>
                    <span class={cls("st", f.conflict ? "st-conflict" : `st-${f.status}`)}>{f.conflict ? "C" : statusLetter(f.status)}</span>
                  </div>
                );
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Collapses every folder in the open revisions' file lists, or expands them once all are collapsed. */
function CollapseAllButton({ folders, collapsed, onChange }: { folders: string[]; collapsed: Set<string>; onChange: (next: Set<string>) => void }) {
  const allCollapsed = folders.length > 0 && folders.every((k) => collapsed.has(k));
  return (
    <button
      class="icon-btn"
      title={allCollapsed ? "Expand all folders" : "Collapse all folders"}
      disabled={folders.length === 0}
      onClick={() => {
        const next = new Set(collapsed);
        for (const k of folders) {
          if (allCollapsed) next.delete(k);
          else next.add(k);
        }
        onChange(next);
      }}
    >
      <Icon name={allCollapsed ? "expand-all" : "collapse-all"} />
    </button>
  );
}

/** Warns about divergent changes (one change ID, several visible commits) and offers the fix. */
function DivergenceBanner({ revisions, onCompare }: { revisions: Revision[]; onCompare: (rev: Revision) => void }) {
  const changes = [...new Map(revisions.map((r) => [r.divergentChangeId ?? r.changeId, r])).values()];
  const first = changes[0];
  return (
    <div class="banner banner-warn">
      <Icon name="warning" />
      <span class="banner-text">
        {changes.length === 1 ? (
          <span>
            <span class="mono">{shortId(first)}</span> is divergent: {revisions.length} versions of the same change are visible, usually from
            editing it in two places at once.
          </span>
        ) : (
          <span>{changes.length} changes are divergent: each has more than one visible version.</span>
        )}
        <span class="banner-actions">
          <button class="btn btn-primary btn-sm" onClick={() => act({ kind: "resolveDivergence", changeId: first.changeId })}>
            Keep one version…
          </button>
          <button class="btn btn-secondary btn-sm" onClick={() => onCompare(first)}>
            View history
          </button>
        </span>
      </span>
    </div>
  );
}

function statusLetter(status: ChangedFile["status"]) {
  return { modified: "M", added: "A", removed: "D", copied: "C", renamed: "R" }[status];
}

function Chips({
  rev,
  remoteTargets,
  onDragBookmark,
}: {
  rev: Revision;
  remoteTargets: Map<string, Set<string>>;
  onDragBookmark: (e: DragEvent, name: string) => void;
}) {
  const local = new Set(rev.localBookmarks.map((b) => b.name));
  const chips = [];
  if (rev.isWorkingCopy) chips.push(<span class="chip chip-here">You are here</span>);
  for (const b of rev.localBookmarks) {
    const conflicted = b.targets.length > 1;
    const remotes = remoteTargets.get(b.name);
    const unpushed = !!remotes && ![...remotes].every((t) => b.targets.includes(t));
    chips.push(
      <span
        class={cls("chip", conflicted ? "chip-conflict" : rev.inTrunk ? "chip-trunk" : "chip-local")}
        title={conflicted ? `${b.name} is conflicted` : unpushed ? `${b.name} differs from the remote` : `Drag to move ${b.name}`}
        draggable
        onDragStart={(e) => onDragBookmark(e, b.name)}
      >
        {b.name}
        {conflicted ? "??" : unpushed ? "*" : ""}
      </span>,
    );
  }
  for (const rb of rev.remoteBookmarks) {
    if (local.has(rb.name)) continue;
    chips.push(<span class="chip chip-remote">{`${rb.name}@${rb.remote}`}</span>);
  }
  for (const t of rev.tags) chips.push(<span class="chip chip-tag">{t}</span>);
  if (rev.divergent) chips.push(<span class="chip chip-conflict" title="Divergent change">divergent</span>);
  return chips.length ? <span class="chips">{chips}</span> : null;
}

function DescribeEditor({
  rev,
  indent,
  onSave,
  onCancel,
}: {
  rev: Revision;
  indent: number;
  onSave: (message: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = () => onSave(ref.current?.value.trimEnd() ?? "");
  return (
    <div class="describe-editor" style={{ paddingLeft: `${indent}px` }}>
      <textarea
        ref={ref}
        rows={Math.min(10, Math.max(3, rev.description.split("\n").length + 1))}
        defaultValue={rev.description.trimEnd()}
        placeholder="Describe this revision"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div class="actions-row">
        <button class="btn btn-primary btn-sm" onClick={save}>
          Save
        </button>
        <button class="btn btn-secondary btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <div class="spacer" />
        <button class="link" onClick={() => notSupported("Describe in an editor tab")}>
          Open in editor
        </button>
      </div>
      <div class="hint">⌘↵ save · Esc cancel · jj describe -r {shortId(rev)}</div>
    </div>
  );
}
