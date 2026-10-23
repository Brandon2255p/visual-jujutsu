// Captures README screenshots of the webview UI using the dev harness's sample data.
// Usage: npm run build && node scripts/screenshots.mjs   (needs `npx playwright install chromium`)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "docs/images");
await mkdir(out, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(root)) throw new Error("outside root");
    res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream" });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/webview/dev.html`;

const browser = await chromium.launch();

async function open(mode, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(`${base}?mode=${mode}`);
  await page.addStyleTag({
    content: `
      body { background: #1f1f1f; }
      body[data-mode="graph"] #app { height: calc(100% - 35px); border-right: 1px solid #2b2b2b; }
      .vj-view-title { width: 360px; height: 35px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
        background: #181818; color: #cccccc; font: 600 11px/1 -apple-system, "Segoe UI", sans-serif; letter-spacing: .04em;
        border-right: 1px solid #2b2b2b; }
      .vj-view-title span { color: #9d9d9d; font-weight: 400; letter-spacing: 0; text-transform: none; }
    `,
  });
  if (mode === "graph") {
    await page.evaluate(() => {
      const t = document.createElement("div");
      t.className = "vj-view-title";
      t.innerHTML = "VISUAL JUJUTSU <span>visual-jujutsu</span>";
      document.body.prepend(t);
    });
    await page.waitForSelector(".row");
  } else {
    await page.waitForSelector(".dialog h1");
  }
  return page;
}

const row = (id) => `[data-id^="${id}"] .row`;

/** Starts an HTML5 drag and hovers it over a target without dropping. */
async function dragOver(page, source, target, opts = {}) {
  await page.evaluate(
    ({ source, target, opts }) => {
      const dt = new DataTransfer();
      const s = document.querySelector(source);
      const t = document.querySelector(target);
      const sr = s.getBoundingClientRect();
      s.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt, clientX: sr.left + 40, clientY: sr.top + 8 }));
      return new Promise((done) =>
        setTimeout(() => {
          const tr = t.getBoundingClientRect();
          const y = opts.edge === "bottom" ? tr.bottom - 2 : tr.top + tr.height / 2;
          t.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tr.left + 120, clientY: y, altKey: !!opts.alt }));
          done();
        }, 50),
      );
    },
    { source, target, opts },
  );
}

async function ghost(page, target, label) {
  // A drag image isn't part of the page, so draw one where the pointer would be.
  await page.evaluate(
    ({ target, label }) => {
      const r = document.querySelector(target).getBoundingClientRect();
      const g = document.createElement("div");
      g.textContent = label;
      g.style.cssText = `position:fixed;left:${r.left + 170}px;top:${r.top + 16}px;padding:3px 10px;border-radius:4px;
        background:#0078d4;color:#fff;font:600 11px -apple-system,sans-serif;box-shadow:0 4px 10px rgba(0,0,0,.4);z-index:50`;
      document.body.appendChild(g);
    },
    { target, label },
  );
}

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

// 2. Moving files between revisions
{
  const page = await open("graph", 360, 560);
  await page.click(row("ryzxvmos"));
  await page.waitForSelector(".file");
  const files = await page.$$(".file");
  await files[0].click({ modifiers: ["Meta"] });
  await files[1].click({ modifiers: ["Meta"] });
  await dragOver(page, ".file.selected", row("mzkroyxu"));
  await ghost(page, row("mzkroyxu"), "2 files");
  await shot(page, "move-files.png");
  await page.close();
}

// 3. Drag-and-drop rebase
{
  const page = await open("graph", 360, 560);
  await dragOver(page, row("vnolmswp"), row("ryzxvmos"));
  await ghost(page, row("ryzxvmos"), "vnolmswp + 1 descendant");
  await shot(page, "drag-rebase.png");
  await page.close();
}

// 4. Context menu with the Rebase submenu open
{
  const page = await open("graph", 720, 640);
  await page.click(row("ryzxvmos"), { button: "right", position: { x: 150, y: 14 } });
  await page.hover(".menu-item:has-text('Rebase')");
  await shot(page, "context-menu.png", { x: 0, y: 0, width: 720, height: 640 });
  await page.close();
}

// 5. Rebase dialog
{
  const page = await open("rebase", 920, 900);
  const h = await page.evaluate(() => document.querySelector(".dialog").getBoundingClientRect().bottom);
  await shot(page, "rebase-dialog.png", { x: 0, y: 0, width: 920, height: Math.ceil(h) });
  await page.close();
}

// 6. Create pull request
{
  const page = await open("createPr", 920, 640);
  const h = await page.evaluate(() => document.querySelector(".dialog").getBoundingClientRect().bottom);
  await shot(page, "create-pr.png", { x: 0, y: 0, width: 920, height: Math.ceil(h) });
  await page.close();
}

await browser.close();
server.close();
console.log(`wrote ${shots.map((s) => "docs/images/" + s).join(", ")}`);
