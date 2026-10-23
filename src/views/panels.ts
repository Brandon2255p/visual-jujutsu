import * as vscode from "vscode";
import type { Controller } from "../controller";
import type { HostMessage, WebviewMessage } from "../shared/protocol";
import { shortChangeId } from "../shared/types";
import { WebviewMode, webviewHtml, webviewOptions } from "./html";

/** Opens an editor-tab webview (rebase dialog, create PR form). */
function openPanel(
  extensionUri: vscode.Uri,
  mode: WebviewMode,
  title: string,
  initial: HostMessage,
  onMessage: (m: WebviewMessage, panel: vscode.WebviewPanel) => Promise<void>,
) {
  const panel = vscode.window.createWebviewPanel(`visualJujutsu.${mode}`, title, vscode.ViewColumn.Active, {
    ...webviewOptions(extensionUri),
    retainContextWhenHidden: true,
  });
  panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "icon.svg");
  panel.webview.html = webviewHtml(panel.webview, extensionUri, mode);
  panel.webview.onDidReceiveMessage(async (m: WebviewMessage) => {
    if (m.type === "ready") void panel.webview.postMessage(initial);
    else if (m.type === "closePanel") panel.dispose();
    else await onMessage(m, panel);
  });
  return panel;
}

export function openRebaseDialog(extensionUri: vscode.Uri, controller: Controller, changeId: string) {
  const data = controller.rebaseDialogData(changeId);
  if (!data) return void vscode.window.showErrorMessage("That revision is not in the graph. Refresh and try again.");
  openPanel(extensionUri, "rebase", `Rebase ${shortChangeId(data.revision)}`, { type: "rebaseDialog", data }, async (m, panel) => {
    if (m.type === "rebaseSubmit") {
      panel.dispose();
      await controller.run(m.action);
    } else if (m.type === "action") {
      await controller.run(m.action);
    }
  });
}

export function openCreatePullRequest(extensionUri: vscode.Uri, controller: Controller, changeId: string) {
  const data = controller.createPrDialogData(changeId);
  if (!data) return void vscode.window.showErrorMessage("That revision is not in the graph. Refresh and try again.");
  openPanel(extensionUri, "createPr", "Create pull request", { type: "createPrDialog", data }, async (m, panel) => {
    if (m.type === "createPrSubmit") {
      void panel.webview.postMessage({ type: "busy", busy: true, label: "Creating pull request…" } satisfies HostMessage);
      const ok = await controller.createPullRequest(m.request);
      if (ok) panel.dispose();
      else void panel.webview.postMessage({ type: "busy", busy: false } satisfies HostMessage);
    } else if (m.type === "action") {
      await controller.run(m.action);
    }
  });
}
