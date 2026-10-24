// Loads the built extension into VS Code with a two-repo workspace and runs
// test/e2e/suite.cjs inside the extension host.
// Usage: npm run build && node test/e2e/run.mjs [path-to-vscode-executable]
import { runTests } from "@vscode/test-electron";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const repo = mkdtempSync(join(tmpdir(), "vj-e2e-"));
const other = mkdtempSync(join(tmpdir(), "vj-e2e-other-"));
const jj = (...a) => execFileSync("jj", ["--color=never", ...a], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
execFileSync("jj", ["git", "init", "."], { cwd: other, stdio: "ignore" });
jj("git", "init", "--colocate", ".");
writeFileSync(join(repo, "a.txt"), "one\n");
jj("describe", "-m", "base");
jj("bookmark", "create", "main", "-r", "@");
jj("new", "-m", "feature");
writeFileSync(join(repo, "b.txt"), "two\n");
// Multi-root: the suite works in the first folder and checks both repos are found.
const workspace = join(mkdtempSync(join(tmpdir(), "vj-e2e-ws-")), "test.code-workspace");
writeFileSync(
  workspace,
  JSON.stringify({
    folders: [{ path: repo }, { path: other }],
    settings: { "visualJujutsu.confirmDestructiveActions": false, "visualJujutsu.fetchBeforeRebaseOnTrunk": false },
  }),
);

await runTests({
  vscodeExecutablePath: process.argv[2] ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, "test/e2e/suite.cjs"),
  launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes", `--user-data-dir=${mkdtempSync(join(tmpdir(), "vj-e2e-user-"))}`],
});
