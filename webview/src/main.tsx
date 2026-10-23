import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { CreatePrDialogData, RebaseDialogData } from "../../src/shared/protocol";
import { CreatePrDialog } from "./dialogs/CreatePrDialog";
import { RebaseDialog } from "./dialogs/RebaseDialog";
import { GraphView } from "./graph/GraphView";
import { onMessage, post } from "./vscode";
import css from "./styles.css";

const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

function Dialog() {
  const [rebase, setRebase] = useState<RebaseDialogData | null>(null);
  const [pr, setPr] = useState<CreatePrDialogData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const off = onMessage((m) => {
      if (m.type === "rebaseDialog") setRebase(m.data);
      if (m.type === "createPrDialog") setPr(m.data);
      if (m.type === "busy") setBusy(m.busy ? (m.label ?? "Working…") : null);
    });
    post({ type: "ready" });
    return () => void off();
  }, []);
  if (rebase) return <RebaseDialog data={rebase} />;
  if (pr) return <CreatePrDialog data={pr} busy={busy} />;
  return <div class="dialog">Loading…</div>;
}

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? document.body.dataset.mode ?? "graph";
document.body.dataset.mode = mode;
render(mode === "graph" ? <GraphView /> : <Dialog />, document.getElementById("app")!);
