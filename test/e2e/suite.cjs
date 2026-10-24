const vscode = require("vscode");
const assert = require("node:assert");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const execAsync = promisify(execFile);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.run = async function run() {
  const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
  // Async on purpose: a sync call would block the extension host while it holds the working-copy lock.
  const jj = async (...a) => (await execAsync("jj", ["--color=never", ...a], { cwd })).stdout.trim();
  const idOf = async (desc) => jj("log", "--no-graph", "-r", `description(exact:"${desc}\n")`, "-T", "change_id");

  const step = (m) => console.log("e2e step: " + m);
  step("start");
  const ext = vscode.extensions.getExtension("OpenProcess.visual-jujutsu");
  assert.ok(ext, "extension is installed");
  await ext.activate();
  step("activated");
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("visualJujutsu.refresh"), "commands registered");

  // Open the graph view so the webview resolves.
  step("opening view");
  await vscode.commands.executeCommand("workbench.view.extension.visualJujutsu");
  for (let i = 0; i < 30; i++) {
    if ((await vscode.commands.executeCommand("visualJujutsu.internal.debugState")).webviewReady) break;
    await sleep(200);
  }
  assert.ok((await vscode.commands.executeCommand("visualJujutsu.internal.debugState")).webviewReady, "webview script started");

  step("webview ok");
  const children = async (rev) => (await jj("log", "--no-graph", "-r", `children(${rev})`, "-T", 'change_id ++ "\n"')).split("\n").filter(Boolean);
  const base = await idOf("base");
  const feature = await idOf("feature");

  // New revision on top of base: @ moves to it, so base has two children.
  await vscode.commands.executeCommand("visualJujutsu.newRevision", base);
  step("new");
  assert.strictEqual((await children(base)).length, 2, "base now has two children");

  // Editing feature leaves the empty revision, which jj abandons.
  await vscode.commands.executeCommand("visualJujutsu.edit", feature);
  step("edit");
  assert.strictEqual(await jj("log", "--no-graph", "-r", "@", "-T", "change_id"), feature, "@ moved to feature");
  assert.deepStrictEqual(await children(base), [feature]);

  // Diff content provider reads files at a revision.
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(`jj-rev:/b.txt?rev=${feature}`));
  assert.strictEqual(doc.getText(), "two\n");
  step("diff provider");

  // Abandon feature (confirmation is disabled in the test settings), then undo.
  await vscode.commands.executeCommand("visualJujutsu.abandon", feature);
  step("abandon");
  assert.ok(!(await children(base)).includes(feature), "feature abandoned");
  await vscode.commands.executeCommand("visualJujutsu.undo");
  step("undo");
  assert.deepStrictEqual(await children(base), [feature], "undo restored feature");

  // A failing command must not hang (its error is shown without waiting).
  await vscode.commands.executeCommand("visualJujutsu.edit", "doesnotexist");
  step("failed command returned");

  // Absorb a working-copy edit back into the revision that added the file.
  await vscode.commands.executeCommand("visualJujutsu.newRevision", feature);
  writeFileSync(join(cwd, "b.txt"), "two (absorbed)\n");
  await vscode.commands.executeCommand("visualJujutsu.absorb", "@");
  step("absorb");
  assert.strictEqual(await jj("file", "show", "-r", feature, "b.txt"), "two (absorbed)");

  await vscode.commands.executeCommand("visualJujutsu.squashIntoParent", feature);
  step("squash");
  assert.ok((await jj("file", "list", "-r", base)).includes("b.txt"), "b.txt squashed into base");

  console.log("e2e: all checks passed");
};
