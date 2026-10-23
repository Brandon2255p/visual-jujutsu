// Loads the built extension into VS Code against a scratch jj repo and runs
// test/e2e/suite.cjs inside the extension host.
// Usage: npm run build && node test/e2e/run.mjs [path-to-vscode-executable]
import { runTests } from "@vscode/test-electron";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const repo = mkdtempSync(join(tmpdir(), "vj-e2e-"));
const jj = (...a) => execFileSync("jj", ["--color=never", ...a], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
jj("git", "init", "--colocate", ".");
writeFileSync(join(repo, "a.txt"), "one\n");
jj("describe", "-m", "base");
jj("bookmark", "create", "main", "-r", "@");
jj("new", "-m", "feature");
writeFileSync(join(repo, "b.txt"), "two\n");
mkdirSync(join(repo, ".vscode"));
writeFileSync(
  join(repo, ".vscode/settings.json"),
  JSON.stringify({ "visualJujutsu.confirmDestructiveActions": false, "visualJujutsu.fetchBeforeRebaseOnTrunk": false }),
);

await runTests({
  vscodeExecutablePath: process.argv[2] ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, "test/e2e/suite.cjs"),
  launchArgs: [repo, "--disable-extensions", "--skip-welcome", "--skip-release-notes", `--user-data-dir=${mkdtempSync(join(tmpdir(), "vj-e2e-user-"))}`],
});
