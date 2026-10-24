import { useState } from "preact/hooks";
import type { ChangedFile, EvologEntry } from "../../../src/shared/types";
import { Icon } from "../icons";
import { act, post } from "../vscode";
import { cls, firstLine, relativeTime, splitPath } from "../util";

export interface EvologTarget {
  changeId: string;
  label: string;
}

/** Key for the files changed between two versions (shared with the files message). */
export const versionKey = (from: string, to: string) => `evolog:${from}..${to}`;

const STATUS = { modified: "M", added: "A", removed: "D", copied: "C", renamed: "R" } as const;

/** Every version a change has been through (jj evolog), with diffs between versions. */
export function EvoLog(props: {
  target: EvologTarget;
  entries: EvologEntry[] | null;
  error: string | null;
  files: Map<string, ChangedFile[]>;
  onBack: () => void;
}) {
  const { target, entries } = props;
  const [selected, setSelected] = useState<string | null>(null);

  const select = (i: number) => {
    const e = entries![i];
    const prev = entries![i + 1];
    if (selected === e.commitId) return setSelected(null);
    setSelected(e.commitId);
    if (prev && !props.files.has(versionKey(prev.commitId, e.commitId))) {
      post({ type: "loadVersionFiles", key: versionKey(prev.commitId, e.commitId), from: prev.commitId, to: e.commitId });
    }
  };

  return (
    <>
      <div class="evolog-head">
        <button class="btn btn-ghost btn-sm" title="Back to the graph" onClick={props.onBack}>
          <Icon name="chevron-left" /> Graph
        </button>
        <span class="evolog-title">
          Evolution of <span class="mono">{target.label}</span>
        </span>
      </div>
      <div class="graph ops" tabIndex={0}>
        {!entries && !props.error && <div class="empty-state">Loading the evolution log…</div>}
        {props.error && <div class="empty-state">{props.error}</div>}
        {entries?.map((e, i) => {
          const prev = entries[i + 1];
          const files = prev ? props.files.get(versionKey(prev.commitId, e.commitId)) : undefined;
          const open = selected === e.commitId;
          const version = entries.length - i;
          return (
            <div key={e.commitId} class={cls("op", open && "selected")} onClick={() => select(i)}>
              <span class="evo-version mono">v{version}</span>
              <div class="op-body">
                <div class="op-desc">{firstLine(e.description) || <span class="muted">(no description set)</span>}</div>
                <div class="op-meta">
                  <span class="mono op-id">{e.commitShort}</span>
                  <span>· {relativeTime(e.time)} ago</span>
                  {i === 0 && <span class="chip chip-here">current</span>}
                  {e.empty && <span class="chip chip-tag">empty</span>}
                  {e.conflict && <span class="chip chip-conflict">conflict</span>}
                </div>
                {e.operation && <div class="op-meta">{firstLine(e.operation)}</div>}
                {open && (
                  <div class="evo-files" onClick={(ev) => ev.stopPropagation()}>
                    {!prev && <div class="op-meta">The first version of this change.</div>}
                    {prev && !files && <div class="op-meta">Loading changes…</div>}
                    {prev && files?.length === 0 && <div class="op-meta">Same files as v{version - 1} (description or parents changed).</div>}
                    {prev &&
                      files?.map((f) => {
                        const { name, dir } = splitPath(f.path);
                        return (
                          <div
                            class="file"
                            title={`Compare ${f.path} in v${version - 1} and v${version}`}
                            onClick={() =>
                              act({ kind: "openVersionDiff", from: prev.commitId, to: e.commitId, path: f.path, title: `${name} (v${version - 1} ↔ v${version})` })
                            }
                          >
                            <Icon name="file" />
                            <span>{name}</span>
                            <span class="dir">{dir}</span>
                            <span class="add">+{f.added}</span>
                            <span class="del">−{f.removed}</span>
                            <span class={`st st-${f.status}`}>{STATUS[f.status]}</span>
                          </div>
                        );
                      })}
                    <div class="op-actions">
                      <button
                        class="btn btn-primary btn-sm"
                        disabled={i === 0}
                        title={i === 0 ? "This is the current version" : "jj restore --from <this version> --into <change>"}
                        onClick={() => act({ kind: "restoreVersion", changeId: target.changeId, commitId: e.commitId, label: `v${version}` })}
                      >
                        Restore this version
                      </button>
                      <button class="btn btn-secondary btn-sm" onClick={() => act({ kind: "copy", text: e.commitId, label: "commit ID" })}>
                        Copy commit ID
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {entries && (
          <div class="op-note">
            <Icon name="info" />
            <span>
              Each version is a commit jj recorded for this change. Click one to see what changed since the version before it. Restore copies that
              version’s files back; the description stays.
            </span>
          </div>
        )}
      </div>
    </>
  );
}
