// Renders site/og-image.png (1200×630), the link preview image for the GitHub Pages site.
// Usage: node scripts/site.mjs && node scripts/og-image.mjs   (needs `npx playwright install chromium`)
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dataUri = async (path, type) => `data:${type};base64,${(await readFile(join(root, path))).toString("base64")}`;
const icon = await dataUri("media/marketplace-icon.svg", "image/svg+xml");
const graph = await dataUri("docs/images/graph.png", "image/png");

const html = `<!doctype html><html><body style="margin:0">
<div style="width:1200px;height:630px;box-sizing:border-box;padding:64px 72px;display:flex;gap:56px;align-items:center;
  background:linear-gradient(135deg,#26292f,#15171a);color:#e6e8eb;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;overflow:hidden">
  <div style="flex:1">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:36px">
      <img src="${icon}" width="72" height="72"><span style="font-size:34px;font-weight:650">Visual Jujutsu</span>
    </div>
    <div style="font-size:58px;line-height:1.08;font-weight:700;letter-spacing:-0.02em">The jj revision graph for VS Code</div>
    <div style="font-size:26px;line-height:1.4;color:#a9b0b8;margin-top:24px">Drag to rebase, move files between revisions and open stacked pull requests.</div>
  </div>
  <img src="${graph}" style="width:400px;border-radius:12px;border:1px solid #2e3238;box-shadow:0 24px 60px rgba(0,0,0,.5);margin-bottom:-120px">
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: join(root, "site/og-image.png") });
await browser.close();
console.log("wrote site/og-image.png");
