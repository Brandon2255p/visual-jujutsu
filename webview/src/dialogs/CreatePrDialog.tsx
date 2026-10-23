import { useState } from "preact/hooks";
import type { CreatePrDialogData } from "../../../src/shared/protocol";
import { nodeKind } from "../../../src/shared/types";
import { NodeIcon } from "../graph/Gutter";
import { Icon } from "../icons";
import { post } from "../vscode";
import { cls, firstLine } from "../util";

export function CreatePrDialog({ data, busy }: { data: CreatePrDialogData; busy: string | null }) {
  const rev = data.revision;
  const existing = rev.localBookmarks.map((b) => b.name);
  const lines = rev.description.trim().split("\n");
  const [head, setHead] = useState(data.suggestedHead);
  const [base, setBase] = useState(data.suggestedBase);
  const [title, setTitle] = useState(lines[0] ?? "");
  const [body, setBody] = useState(lines.slice(1).join("\n").trim());
  const [pushFirst] = useState(true);
  const createHead = !existing.includes(head);

  const command = [
    ...(createHead ? [`jj bookmark create ${head} -r ${rev.short.prefix}${rev.short.rest}`] : []),
    `jj git push -b ${head}`,
    `gh pr create --head ${head} --base ${base} --title ${JSON.stringify(title)} --body-file -`,
  ].join("\n");

  const submit = (draft: boolean) =>
    post({ type: "createPrSubmit", request: { changeId: rev.changeId, head, createHead, base, title, body, draft } });

  return (
    <div class="dialog">
      <div>
        <h1>Create pull request</h1>
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
        <div class="col" style={{ flex: "1 1 460px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div class="field" style={{ flex: 1 }}>
              <label>Head bookmark</label>
              {existing.length ? (
                <select class="select" value={head} onChange={(e) => setHead((e.currentTarget as HTMLSelectElement).value)}>
                  {data.headOptions.map((h) => (
                    <option value={h}>{existing.includes(h) ? h : `${h} (new)`}</option>
                  ))}
                </select>
              ) : (
                <div class="input-wrap">
                  <input class="mono" value={head} onInput={(e) => setHead((e.currentTarget as HTMLInputElement).value)} />
                </div>
              )}
              <span class="hint">{createHead ? "A new bookmark will be created on this revision." : "Existing bookmark on this revision."}</span>
            </div>
            <div class="field" style={{ flex: 1 }}>
              <label>Base</label>
              <select class="select" value={base} onChange={(e) => setBase((e.currentTarget as HTMLSelectElement).value)}>
                {data.baseOptions.map((b) => (
                  <option value={b}>{b}</option>
                ))}
              </select>
              <span class="hint">{data.baseReason}</span>
            </div>
          </div>
          <div class="field">
            <label>Title</label>
            <div class="input-wrap">
              <input value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
            </div>
          </div>
          <div class="field">
            <label>Description</label>
            <textarea
              rows={8}
              style={{ borderColor: "var(--vj-input-border)" }}
              value={body}
              placeholder="Prefilled from the revision description."
              onInput={(e) => setBody((e.currentTarget as HTMLTextAreaElement).value)}
            />
          </div>
          <label class="check-row" title="The bookmark must be on GitHub before a PR can be opened.">
            <input type="checkbox" checked={pushFirst} disabled />
            Push bookmark before creating (jj git push -b {head})
          </label>
        </div>
        <div class="col" style={{ flex: "0 1 280px", minWidth: "240px" }}>
          <div class="section">
            <div class="section-title">Stack</div>
            <div class="stack-list">
              {data.stack.map((s, i) => (
                <div class={cls("stack-row", i === 0 && "current")}>
                  <NodeIcon kind={nodeKind(s.revision)} />
                  <span class="change-id mono">
                    <span class="p">{s.revision.short.prefix}</span>
                    <span class="r">{s.revision.short.rest}</span>
                  </span>
                  {s.bookmark && <span class={cls("chip", s.revision.inTrunk ? "chip-trunk" : "chip-local")}>{s.bookmark}</span>}
                  <span class="spacer" />
                  {s.pr ? (
                    <span class={cls("pr", s.pr.isDraft ? "pr-draft" : "pr-open")}>
                      <Icon name="pull-request" />#{s.pr.number}
                    </span>
                  ) : i === 0 ? (
                    <span class="hint" style={{ color: "var(--vj-link)" }}>
                      new PR
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <span class="hint">Each PR in a stack uses the bookmark below it as its base.</span>
          </div>
        </div>
      </div>
      <div class="cmd-box">
        <Icon name="terminal" />
        <pre>{command}</pre>
      </div>
      <div class="dialog-actions">
        {busy && <span class="hint" style={{ marginRight: "auto", alignSelf: "center" }}>{busy}</span>}
        <button class="btn btn-secondary" onClick={() => post({ type: "closePanel" })}>
          Cancel
        </button>
        <button class="btn btn-secondary" disabled={!!busy || !title.trim()} onClick={() => submit(true)}>
          Create draft
        </button>
        <button class="btn btn-primary" disabled={!!busy || !title.trim()} onClick={() => submit(false)}>
          Create pull request
        </button>
      </div>
    </div>
  );
}
