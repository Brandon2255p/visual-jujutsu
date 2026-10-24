import { useState } from "preact/hooks";
import type { Operation } from "../../../src/shared/types";
import { Icon, IconName } from "../icons";
import { act } from "../vscode";
import { cls, firstLine, relativeTime } from "../util";

function iconFor(description: string): IconName {
  const d = description.toLowerCase();
  if (d.startsWith("rebase")) return "rebase";
  if (d.startsWith("describe")) return "edit";
  if (d.startsWith("squash") || d.startsWith("absorb") || d.startsWith("split")) return "move-file";
  if (d.startsWith("fetch")) return "fetch";
  if (d.startsWith("push")) return "push";
  if (d.startsWith("new") || d.startsWith("create")) return "plus";
  if (d.startsWith("undo") || d.startsWith("restore") || d.startsWith("redo")) return "undo";
  if (d.startsWith("snapshot")) return "refresh";
  return "history";
}

/** The operation log: every change jj recorded, with restore to any point. */
export function OpLog({ operations }: { operations: Operation[] | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const shown = (operations ?? []).filter((o) => !filter || o.description.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div class="revset">
        <div class="input-wrap">
          <Icon name="search" />
          <input value={filter} placeholder="Filter operations" spellcheck={false} onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
        </div>
      </div>
      <div class="graph ops" tabIndex={0}>
        {!operations && <div class="empty-state">Loading operations…</div>}
        {operations && shown.length === 0 && <div class="empty-state">No operations match.</div>}
        {shown.map((op) => (
          <div key={op.id} class={cls("op", selected === op.id && "selected")} onClick={() => setSelected(selected === op.id ? null : op.id)}>
            <Icon name={iconFor(op.description)} class={op.current ? "op-icon current" : "op-icon"} />
            <div class="op-body">
              <div class="op-desc">{firstLine(op.description)}</div>
              <div class="op-meta">
                <span class="mono op-id">{op.id.slice(0, 12)}</span>
                <span>
                  · {relativeTime(op.time)} ago · {op.user}
                </span>
                {op.current && <span class="chip chip-here">current</span>}
              </div>
              {selected === op.id && (
                <div class="op-actions">
                  <button
                    class="btn btn-primary btn-sm"
                    disabled={op.current}
                    title={op.current ? "This is the current state" : "jj op restore"}
                    onClick={(e) => {
                      e.stopPropagation();
                      act({ kind: "restoreOperation", id: op.id, description: firstLine(op.description) });
                    }}
                  >
                    Restore to here
                  </button>
                  <button
                    class="btn btn-secondary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      act({ kind: "copy", text: op.id, label: "operation ID" });
                    }}
                  >
                    Copy ID
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {operations && (
          <div class="op-note">
            <Icon name="info" />
            <span>Restoring goes back to that point in the repo’s history (jj op restore). It is itself an operation, so you can undo it.</span>
          </div>
        )}
      </div>
    </>
  );
}
