import { useState } from "preact/hooks";
import type { RebaseDialogData, RebaseSource, RebaseTarget } from "../../../src/shared/protocol";
import { nodeKind } from "../../../src/shared/types";
import { NodeIcon } from "../graph/Gutter";
import { Icon } from "../icons";
import { notSupported, post } from "../vscode";
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

export function RebaseDialog({ data }: { data: RebaseDialogData }) {
  const rev = data.revision;
  const [source, setSource] = useState<RebaseSource>("s");
  const [target, setTarget] = useState<RebaseTarget>("o");
  const [destination, setDestination] = useState(data.defaultDestination ?? "trunk()");
  const [skipEmptied, setSkipEmptied] = useState(false);

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
            <div class="callout">
              <Icon name="info" />
              <span>
                A before/after preview with a conflict check is coming in a later release. Until then, rebase and press ⌘Z in the graph
                to undo if the result isn’t what you wanted.
              </span>
            </div>
            <div>
              <button class="btn btn-secondary" onClick={() => notSupported("Rebase preview")}>
                <Icon name="eye" /> Preview
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
            post({ type: "rebaseSubmit", action: { kind: "rebase", source, changeId: rev.changeId, target, destination, skipEmptied } })
          }
        >
          Rebase
        </button>
      </div>
    </div>
  );
}
