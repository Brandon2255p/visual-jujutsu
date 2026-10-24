import { useEffect, useMemo, useState } from "preact/hooks";
import type { RebaseDialogData, RebasePreview, RebaseSource, RebaseTarget } from "../../../src/shared/protocol";
import { nodeKind, type Revision } from "../../../src/shared/types";
import { layoutGraph } from "../../../src/shared/graph";
import { Gutter, NodeIcon, gutterWidth } from "../graph/Gutter";
import { Icon } from "../icons";
import { onMessage, post } from "../vscode";
import { cls, firstLine, shortId } from "../util";

const SOURCES: { value: RebaseSource; title: string; desc: string }[] = [
  { value: "r", title: "This revision only", desc: "Descendants stay behind and are rebased onto its parent." },
  { value: "s", title: "This revision and its descendants", desc: "Moves the revision and everything stacked on it." },
  { value: "b", title: "Whole branch", desc: "Every revision in the branch relative to the destination: (dest..rev)::" },
];

const TARGETS: { value: RebaseTarget; title: string; desc: string }[] = [
  { value: "o", title: "Onto", desc: "Becomes a child of the destination. Existing children are not affected." },
  { value: "A", title: "Insert after", desc: "The destination’s existing children are moved on top of the rebased revisions." },
  { value: "B", title: "Insert before", desc: "Placed between the destination and its parent." },
];

export function RadioCard(props: { on: boolean; title: string; flag: string; desc: string; onClick: () => void }) {
  return (
    <button class={cls("radio-card", props.on && "on")} onClick={props.onClick} role="radio" aria-checked={props.on}>
      <span class="radio" />
      <span style={{ flex: 1 }}>
        <span class="t">
          {props.title}
          <span class="flag">{props.flag}</span>
        </span>
        <span class="d">{props.desc}</span>
      </span>
    </button>
  );
}

/** A small read-only graph for the preview, highlighting what the rebase touches. */
function MiniGraph({ revisions, moved, conflicts }: { revisions: Revision[]; moved: Set<string>; conflicts: Set<string> }) {
  const layout = useMemo(() => layoutGraph(revisions), [revisions]);
  const gutterW = gutterWidth(layout.laneCount);
  return (
    <div class="mini-graph">
      {revisions.map((rev, i) => (
        <div class="block" key={rev.changeId}>
          <Gutter row={layout.rows[i]} laneCount={layout.laneCount} kind={nodeKind(rev)} />
          <div
            class={cls("row", moved.has(rev.changeId) && "preview-moved", conflicts.has(rev.changeId) && "preview-conflict")}
            style={{ paddingLeft: `${gutterW}px` }}
          >
            <span class="change-id mono">
              <span class="p">{rev.short.prefix}</span>
              <span class="r">{rev.short.rest}</span>
            </span>
            {rev.localBookmarks.map((b) => (
              <span class="chip chip-local">{b.name}</span>
            ))}
            <span class="desc">{firstLine(rev.description) || "(no description)"}</span>
            {conflicts.has(rev.changeId) && <span class="preview-tag">conflict</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

type PreviewState = { status: "idle" } | { status: "loading" } | { status: "done"; preview: RebasePreview } | { status: "error"; error: string };

export function RebaseDialog({ data }: { data: RebaseDialogData }) {
  const rev = data.revision;
  const [source, setSource] = useState<RebaseSource>("s");
  const [target, setTarget] = useState<RebaseTarget>("o");
  const [destination, setDestination] = useState(data.defaultDestination ?? "trunk()");
  const [skipEmptied, setSkipEmptied] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const action = { kind: "rebase" as const, source, changeId: rev.changeId, target, destination, skipEmptied };

  useEffect(
    () =>
      onMessage((m) => {
        if (m.type !== "rebasePreview") return;
        setPreview(m.preview ? { status: "done", preview: m.preview } : { status: "error", error: m.error ?? "The preview failed." });
      }),
    [],
  );
  // Any change to the options makes the preview out of date.
  useEffect(() => setPreview({ status: "idle" }), [source, target, destination, skipEmptied]);
  const runPreview = () => {
    setPreview({ status: "loading" });
    post({ type: "rebasePreview", action });
  };

  const destLabel = (() => {
    const d = data.candidates.find((c) => c.changeId === destination);
    return d ? shortId(d) : destination;
  })();
  const command = `jj rebase -${source} ${shortId(rev)} -${target} ${destLabel}${skipEmptied ? " --skip-emptied" : ""}`;
  const option = (r: (typeof data.candidates)[number]) =>
    `${shortId(r)}  ${r.localBookmarks.map((b) => b.name).join(", ")}${r.localBookmarks.length ? "  ·  " : ""}${firstLine(r.description) || "(no description)"}`;

  return (
    <div class="dialog">
      <div>
        <h1>Rebase</h1>
        <div class="subtitle">
          <NodeIcon kind={nodeKind(rev)} />
          <span class="change-id mono">
            <span class="p">{rev.short.prefix}</span>
            <span class="r">{rev.short.rest}</span>
          </span>
          <span>{firstLine(rev.description) || "(no description set)"}</span>
        </div>
      </div>
      <div class="columns">
        <div class="col col-fixed">
          <div class="section">
            <div class="section-title">What to move</div>
            {SOURCES.map((s) => (
              <RadioCard on={source === s.value} title={s.title} flag={`-${s.value}`} desc={s.desc} onClick={() => setSource(s.value)} />
            ))}
          </div>
          <div class="section">
            <div class="section-title">Where to put it</div>
            {TARGETS.map((t) => (
              <RadioCard on={target === t.value} title={t.title} flag={`-${t.value}`} desc={t.desc} onClick={() => setTarget(t.value)} />
            ))}
          </div>
          <div class="section">
            <div class="section-title">Destination</div>
            <select class="select" value={destination} onChange={(e) => setDestination((e.currentTarget as HTMLSelectElement).value)}>
              <option value="trunk()">trunk()</option>
              <option value="@">@ (working copy)</option>
              {data.candidates.map((c) => (
                <option value={c.changeId}>{option(c)}</option>
              ))}
            </select>
            <div class="quick">
              Quick:
              <span class="chip chip-trunk" onClick={() => setDestination("trunk()")}>
                trunk()
              </span>
              <span class="chip chip-local" onClick={() => setDestination("@")}>
                @
              </span>
            </div>
          </div>
          <label class="check-row">
            <input type="checkbox" checked={skipEmptied} onChange={(e) => setSkipEmptied((e.currentTarget as HTMLInputElement).checked)} />
            Skip revisions that become empty (--skip-emptied)
          </label>
        </div>
        <div class="col">
          <div class="section">
            <div class="section-title">Preview</div>
            {preview.status === "idle" && (
              <div class="callout">
                <Icon name="info" />
                <span>See the graph before and after, and which revisions would conflict. Nothing changes until you press Rebase.</span>
              </div>
            )}
            {preview.status === "error" && (
              <div class="callout callout-error">
                <Icon name="x-circle" />
                <span>{preview.error}</span>
              </div>
            )}
            {preview.status === "done" && <PreviewResult preview={preview.preview} />}
            <div>
              <button class="btn btn-secondary" disabled={preview.status === "loading"} onClick={runPreview}>
                <Icon name="eye" /> {preview.status === "loading" ? "Previewing…" : preview.status === "done" ? "Preview again" : "Preview"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="cmd-box">
        <Icon name="terminal" />
        <pre>{command}</pre>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-secondary" onClick={() => post({ type: "closePanel" })}>
          Cancel
        </button>
        <button
          class="btn btn-primary"
          onClick={() =>
            post({ type: "rebaseSubmit", action })
          }
        >
          Rebase
        </button>
      </div>
    </div>
  );
}

function PreviewResult({ preview }: { preview: RebasePreview }) {
  const moved = new Set(preview.moved);
  const conflicts = new Set(preview.conflicts);
  const n = preview.moved.length;
  const c = preview.conflicts.length;
  return (
    <>
      <div class={cls("callout", c > 0 ? "callout-warn" : "callout-ok")}>
        <Icon name={c > 0 ? "x-circle" : "check"} />
        <span>
          {n === 0 ? "Nothing would change." : `Rewrites ${n} revision${n === 1 ? "" : "s"}. `}
          {n > 0 && (c > 0 ? `${c} would become conflicted; you can resolve them after rebasing.` : "No new conflicts.")}
        </span>
      </div>
      <div class="preview-pair">
        <div>
          <div class="preview-label">Before</div>
          <MiniGraph revisions={preview.before} moved={moved} conflicts={new Set()} />
        </div>
        <div>
          <div class="preview-label">After</div>
          <MiniGraph revisions={preview.after} moved={moved} conflicts={conflicts} />
        </div>
      </div>
    </>
  );
}
