import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run jj with an empty user config, like CI and a fresh install, so a
// developer's settings (e.g. auto-track-bookmarks) can't hide a failure.
const config = join(mkdtempSync(join(tmpdir(), "vj-jjconfig-")), "config.toml");
writeFileSync(config, "");
process.env.JJ_CONFIG = config;
