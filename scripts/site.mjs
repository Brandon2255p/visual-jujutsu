// Copies the README images and the icon into site/assets for the GitHub Pages site.
// The Pages workflow runs this before uploading site/; run it locally to preview.
import { cp, mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "site/assets");
await mkdir(out, { recursive: true });
for (const name of await readdir(join(root, "docs/images"))) await cp(join(root, "docs/images", name), join(out, name));
await cp(join(root, "media/marketplace-icon.svg"), join(out, "favicon.svg"));
await cp(join(root, "media/icon.png"), join(out, "icon.png"));
console.log(`copied site assets to ${out}`);
