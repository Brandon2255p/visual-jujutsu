import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { editorCli } from "../src/editorCli";

const only = (...paths: string[]) => (p: string) => paths.includes(p);

describe("editorCli", () => {
  it("finds the launcher inside a macOS app", () => {
    const root = "/Applications/Visual Studio Code.app/Contents/Resources/app";
    expect(editorCli(root, "darwin", only(join(root, "bin", "code")))).toBe(join(root, "bin", "code"));
  });

  it("finds the launcher two folders up on Linux and Windows", () => {
    expect(editorCli("/usr/share/code/resources/app", "linux", only("/usr/share/code/bin/code"))).toBe("/usr/share/code/bin/code");
    const win = join("C:", "VS Code", "resources", "app");
    const cmd = join("C:", "VS Code", "bin", "code.cmd");
    expect(editorCli(win, "win32", only(cmd))).toBe(cmd);
  });

  it("prefers the remote CLI on a remote server", () => {
    const root = "/home/me/.vscode-server/bin/abc123";
    const remote = join(root, "bin", "remote-cli", "code");
    expect(editorCli(root, "linux", only(remote, join(root, "bin", "code-server")))).toBe(remote);
  });

  it("knows other editors' launchers and falls back to code", () => {
    const root = "/Applications/Cursor.app/Contents/Resources/app";
    expect(editorCli(root, "darwin", only(join(root, "bin", "cursor")))).toBe(join(root, "bin", "cursor"));
    expect(editorCli("/nowhere", "darwin", () => false)).toBe("code");
  });
});
