// Captures README screenshots of the webview UI using the dev harness sample data.
// The drag interactions are recorded as GIFs by scripts/gifs.mjs.
// Usage: npm run build && node scripts/screenshots.mjs   (needs `npx playwright install chromium`)
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { root, row, startHarness } from "./harness.mjs";

const out = join(root, "docs/images");
await mkdir(out, { recursive: true });
const { open, close } = await startHarness();

const shots = [];
async function shot(page, name, clip) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(out, name), clip });
  shots.push(name);
}

// 1. Graph overview
{
  const page = await open("graph", 360, 400);
  await page.hover(row("wstlpqnk"));
  await shot(page, "graph.png");
  await page.close();
}

// 2. Context menu with the Rebase submenu open
{
  const page = await open("graph", 720, 640);
  await page.click(row("ryzxvmos"), { button: "right", position: { x: 150, y: 14 } });
  await page.hover(".menu-item:has-text('Rebase')");
  await shot(page, "context-menu.png", { x: 0, y: 0, width: 720, height: 640 });
  await page.close();
}

// 3. Rebase dialog, with the preview shown
{
  const page = await open("rebase", 920, 900);
  await page.click("button:has-text('Preview')");
  await page.waitForSelector(".mini-graph");
  const h = await page.evaluate(() => document.querySelector(".dialog").getBoundingClientRect().bottom);
  await shot(page, "rebase-dialog.png", { x: 0, y: 0, width: 920, height: Math.ceil(h) });
  await page.close();
}

// 4. Create pull request
{
  const page = await open("createPr", 920, 640);
  const h = await page.evaluate(() => document.querySelector(".dialog").getBoundingClientRect().bottom);
  await shot(page, "create-pr.png", { x: 0, y: 0, width: 920, height: Math.ceil(h) });
  await page.close();
}

await close();
console.log(`wrote ${shots.map((s) => "docs/images/" + s).join(", ")}`);
