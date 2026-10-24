import * as vscode from "vscode";
import type { Controller } from "../controller";
import type { ChangedFile } from "../shared/types";

/** A jj-rev: URI for a file at a revision (served by the content provider in extension.ts). */
export function revUri(root: string, revset: string, path: string): vscode.Uri {
  return vscode.Uri.from({ scheme: "jj-rev", path: "/" + path, query: new URLSearchParams({ rev: revset, root }).toString() });
}

const STATUS_TEXT: Record<ChangedFile["status"], string> = {
  modified: "Modified",
  added: "Added",
  removed: "Deleted",
  copied: "Copied",
  renamed: "Renamed",
};

/**
 * Source Control view for a jj repo: the working copy's changed files, gutter
 * quick diffs against the parent (@-), and an input box that describes @.
 */
export class JjSourceControl implements vscode.Disposable {
  private readonly sc: vscode.SourceControl;
  private readonly changes: vscode.SourceControlResourceGroup;
  private readonly conflicts: vscode.SourceControlResourceGroup;
  private readonly disposables: vscode.Disposable[] = [];
  private workingCopyId: string | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly controller: Controller) {
    const root = controller.repo.root;
    this.sc = vscode.scm.createSourceControl("jj", "Jujutsu", vscode.Uri.file(root));
    this.sc.inputBox.placeholder = "Describe the working copy (⌘Enter to save)";
    this.sc.acceptInputCommand = { command: "visualJujutsu.internal.scmDescribe", title: "Describe", arguments: [this] };
    this.sc.quickDiffProvider = {
      provideOriginalResource: (uri) => {
        if (uri.scheme !== "file" || !uri.fsPath.startsWith(root + "/")) return undefined;
        return revUri(root, "@-", uri.fsPath.slice(root.length + 1));
      },
    };
    this.conflicts = this.sc.createResourceGroup("conflicts", "Conflicts");
    this.conflicts.hideWhenEmpty = true;
    this.changes = this.sc.createResourceGroup("workingCopy", "Working copy (@)");
    this.disposables.push(
      this.sc,
      controller.onDidChangeState(() => void this.update()),
    );
    void this.update();
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  get root() {
    return this.controller.repo.root;
  }

  /** Paths listed in the view, conflicts first (for the e2e test). */
  get paths(): string[] {
    return [...this.conflicts.resourceStates, ...this.changes.resourceStates].map((r) => r.resourceUri.fsPath.slice(this.root.length + 1));
  }

  /** Describes @ with the input box text. */
  async describe() {
    const wc = this.controller.currentState?.revisions.find((r) => r.isWorkingCopy);
    const message = this.sc.inputBox.value.trimEnd();
    await this.controller.run({ kind: "describe", changeId: wc?.changeId ?? "@", message });
  }

  private update(): Promise<void> {
    // Coalesce bursts of state changes into one jj call.
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load() {
    const state = this.controller.currentState;
    const wc = state?.revisions.find((r) => r.isWorkingCopy);
    // Fill the box with @'s description when @ changes, without clobbering typing.
    if (wc && wc.changeId !== this.workingCopyId) {
      this.workingCopyId = wc.changeId;
      this.sc.inputBox.value = wc.description.trimEnd();
    }
    let files: ChangedFile[] = [];
    try {
      files = await this.controller.files("@");
    } catch {
      return;
    }
    const root = this.root;
    const toResource = (f: ChangedFile): vscode.SourceControlResourceState => {
      const file = vscode.Uri.file(`${root}/${f.path}`);
      const right = f.status === "removed" ? revUri(root, "@", f.path) : file;
      const name = f.path.split("/").pop();
      return {
        resourceUri: file,
        decorations: {
          tooltip: `${f.conflict ? "Conflicted" : STATUS_TEXT[f.status]} · +${f.added} −${f.removed}`,
          strikeThrough: f.status === "removed",
        },
        command: f.conflict
          ? { command: "vscode.open", title: "Open", arguments: [file] }
          : { command: "vscode.diff", title: "Open changes", arguments: [revUri(root, "@-", f.path), right, `${name} (@)`] },
      };
    };
    this.conflicts.resourceStates = files.filter((f) => f.conflict).map(toResource);
    this.changes.resourceStates = files.filter((f) => !f.conflict).map(toResource);
    this.sc.count = files.length;
  }
}
