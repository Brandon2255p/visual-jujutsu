import { existsSync } from "node:fs";
import { join } from "node:path";

const NAMES = ["code", "code-insiders", "cursor", "windsurf", "codium"];

/**
 * The command line launcher of the running editor, found from its app root
 * (vscode.env.appRoot), so `code --wait --merge` works even when `code` isn't
 * on PATH. Run from the integrated terminal, it opens in this window. Remote
 * windows use the server's remote-cli; local installs keep the launcher in
 * bin (macOS) or two folders up from the app root (Windows, Linux).
 */
export function editorCli(appRoot: string, platform = process.platform, exists: (path: string) => boolean = existsSync): string {
  const ext = platform === "win32" ? ".cmd" : "";
  const dirs = [join(appRoot, "bin", "remote-cli"), join(appRoot, "bin"), join(appRoot, "..", "..", "bin")];
  for (const dir of dirs) {
    for (const name of NAMES) {
      const path = join(dir, name + ext);
      if (exists(path)) return path;
    }
  }
  return "code";
}
