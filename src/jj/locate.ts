import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where jj is usually installed. VS Code started from the Dock or a desktop
 * launcher may not have these on its PATH even though a terminal does.
 */
export function commonJjPaths(home = homedir(), platform = process.platform): string[] {
  if (platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      join(home, ".cargo", "bin", "jj.exe"),
      join(local, "Microsoft", "WinGet", "Links", "jj.exe"),
      join(home, "scoop", "shims", "jj.exe"),
    ];
  }
  return [
    "/opt/homebrew/bin/jj",
    "/usr/local/bin/jj",
    join(home, ".cargo", "bin", "jj"),
    join(home, ".local", "bin", "jj"),
    join(home, ".nix-profile", "bin", "jj"),
    "/nix/var/nix/profiles/default/bin/jj",
    "/home/linuxbrew/.linuxbrew/bin/jj",
    "/snap/bin/jj",
    "/usr/bin/jj",
  ];
}

function runs(exe: string): Promise<boolean> {
  return new Promise((resolve) => execFile(exe, ["--version"], { timeout: 10_000 }, (err) => resolve(!err)));
}

/**
 * The jj executable to use. A path set in the settings is used as is;
 * the default "jj" falls back to the usual install locations when it isn't on PATH.
 */
export async function locateJj(configured: string, candidates = commonJjPaths()): Promise<string> {
  if (configured !== "jj" || (await runs("jj"))) return configured;
  for (const path of candidates) {
    if (existsSync(path) && (await runs(path))) return path;
  }
  return configured;
}
