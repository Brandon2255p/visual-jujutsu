// Shared setup for scripts that capture the webview UI (screenshots, GIFs):
// serves the repo, launches headless Chromium and opens webview/dev.html,
// which runs the real UI against a fake host with sample data.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");

export const row = (id) => `[data-id^="${id}"] .row`;

export async function startHarness() {
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

  /** Opens the UI in `mode` (graph | rebase | createPr) at the given CSS size. */
  async function open(mode, width, height, scale = 2) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
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
      // Stand-in for VS Code's view title bar.
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

  async function close() {
    await browser.close();
    server.close();
  }

  return { open, close };
}
