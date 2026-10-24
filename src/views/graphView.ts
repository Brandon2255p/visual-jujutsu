import * as vscode from "vscode";
import type { Controller } from "../controller";
import type { RepoManager } from "../repoManager";
import type { HostMessage, WebviewMessage } from "../shared/protocol";
import type { GraphState } from "../shared/types";
import { webviewHtml, webviewOptions } from "./html";

/** The sidebar graph. Shows the repo manager's active repo. */
export class GraphViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "visualJujutsu.graph";
  private view: vscode.WebviewView | undefined;
  /** Set once the webview script has started; used by the e2e test. */
  webviewReady = false;
  private readonly disposables: vscode.Disposable[] = [];
  private controllerSubs: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly repos: RepoManager,
  ) {
    this.disposables.push(
      repos.onDidChangeActive(() => this.bindActive()),
      repos.onDidChangeRepos(() => this.postState()),
    );
    this.bindActive();
  }

  dispose() {
    this.controllerSubs.forEach((d) => d.dispose());
    this.disposables.forEach((d) => d.dispose());
  }

  private get controller(): Controller | undefined {
    return this.repos.active?.controller;
  }

  /** Follows the active repo's controller. */
  private bindActive() {
    this.controllerSubs.forEach((d) => d.dispose());
    const controller = this.controller;
    if (!controller) return;
    this.controllerSubs = [
      controller.onDidChangeState((state) => this.postState(state)),
      controller.onDidChangeBusy((b) => this.post({ type: "busy", ...b })),
    ];
    this.postState();
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = webviewOptions(this.extensionUri);
    view.webview.html = webviewHtml(view.webview, this.extensionUri, "graph");
    view.webview.onDidReceiveMessage((m: WebviewMessage) => this.onMessage(m), undefined, this.disposables);
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.controller?.refresh();
    });
    this.postState();
  }

  private postState(state: GraphState | null | undefined = this.controller?.currentState) {
    if (!state) return;
    if (this.view) this.view.description = state.repoName;
    this.post({ type: "state", state: { ...state, repos: this.repos.list() } });
  }

  private post(message: HostMessage) {
    void this.view?.webview.postMessage(message);
  }

  private async onMessage(message: WebviewMessage) {
    const controller = this.controller;
    if (!controller) return;
    switch (message.type) {
      case "ready":
        this.webviewReady = true;
        this.postState();
        await controller.refresh();
        break;
      case "setRevset":
        await controller.setRevset(message.revset);
        break;
      case "loadFiles":
        try {
          const files = await controller.files(message.changeId);
          this.post({ type: "files", changeId: message.changeId, files });
        } catch {
          this.post({ type: "files", changeId: message.changeId, files: [] });
        }
        break;
      case "loadOperations":
        try {
          this.post({ type: "operations", operations: await controller.operations() });
        } catch {
          this.post({ type: "operations", operations: [] });
        }
        break;
      case "action":
        if (message.action.kind === "switchRepo") this.repos.setActive(message.action.root);
        else await controller.run(message.action);
        break;
    }
  }
}
