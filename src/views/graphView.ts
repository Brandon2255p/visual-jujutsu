import * as vscode from "vscode";
import type { Controller } from "../controller";
import type { HostMessage, WebviewMessage } from "../shared/protocol";
import { webviewHtml, webviewOptions } from "./html";

export class GraphViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "visualJujutsu.graph";
  private view: vscode.WebviewView | undefined;
  /** Set once the webview script has started; used by the e2e test. */
  webviewReady = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: Controller,
  ) {
    this.disposables.push(
      controller.onDidChangeState((state) => this.post({ type: "state", state })),
      controller.onDidChangeBusy((b) => this.post({ type: "busy", ...b })),
    );
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.description = this.controller.currentState?.repoName;
    this.disposables.push(this.controller.onDidChangeState((s) => (view.description = s.repoName)));
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.extensionUri, "graph");
    view.webview.onDidReceiveMessage((m: WebviewMessage) => this.onMessage(m), undefined, this.disposables);
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.controller.refresh();
    });
  }

  private post(message: HostMessage) {
    void this.view?.webview.postMessage(message);
  }

  private async onMessage(message: WebviewMessage) {
    switch (message.type) {
      case "ready": {
        this.webviewReady = true;
        const state = this.controller.currentState;
        if (state) this.post({ type: "state", state });
        await this.controller.refresh();
        break;
      }
      case "setRevset":
        await this.controller.setRevset(message.revset);
        break;
      case "loadFiles":
        try {
          const files = await this.controller.files(message.changeId);
          this.post({ type: "files", changeId: message.changeId, files });
        } catch {
          this.post({ type: "files", changeId: message.changeId, files: [] });
        }
        break;
      case "loadOperations":
        try {
          this.post({ type: "operations", operations: await this.controller.operations() });
        } catch {
          this.post({ type: "operations", operations: [] });
        }
        break;
      case "action":
        await this.controller.run(message.action);
        break;
    }
  }
}
