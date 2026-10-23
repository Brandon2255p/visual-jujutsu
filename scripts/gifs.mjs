// Records README GIFs of drag-and-drop rebase and moving files, using the dev
// harness's sample data and a drawn mouse pointer.
// Usage: npm run build && node scripts/gifs.mjs   (needs Playwright Chromium and ImageMagick `magick`)
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root, row, startHarness } from "./harness.mjs";

const FRAME_MS = 60;
const { open, close } = await startHarness();

/** Page-side pointer, drag ghost and HTML5 drag helpers. */
function installOverlay() {
  const cursor = document.createElement("div");
  cursor.innerHTML = `<svg width="18" height="22" viewBox="0 0 18 22"><path d="M1 1 L1 17 L5.5 13 L8.5 20 L11.5 18.6 L8.6 11.8 L14.5 11.8 Z"
    fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  cursor.style.cssText = "position:fixed;left:0;top:0;z-index:1000;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))";
  const ghost = document.createElement("div");
  ghost.style.cssText = `position:fixed;z-index:999;pointer-events:none;display:none;padding:3px 10px;border-radius:4px;
    background:#0078d4;color:#fff;font:600 11px -apple-system,"Segoe UI",sans-serif;box-shadow:0 4px 10px rgba(0,0,0,.45);opacity:.95`;
  document.body.append(ghost, cursor);
  let drag = null;
  const fire = (el, type, x, y, mods = {}) =>
    el?.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: drag.dt, clientX: x, clientY: y, altKey: !!mods.alt, shiftKey: !!mods.shift }));
  window.__gif = {
    pointer(x, y) {
      cursor.style.transform = `translate(${x - 1}px, ${y - 1}px)`;
      ghost.style.left = `${x + 14}px`;
      ghost.style.top = `${y + 16}px`;
    },
    dragStart(selector, label, x, y) {
      drag = { dt: new DataTransfer(), source: document.querySelector(selector) };
      fire(drag.source, "dragstart", x, y);
      ghost.textContent = label;
      ghost.style.display = "block";
    },
    dragOver(x, y, mods) {
      fire(document.elementFromPoint(x, y), "dragover", x, y, mods);
    },
    drop(x, y, mods) {
      fire(document.elementFromPoint(x, y), "drop", x, y, mods);
      fire(drag.source, "dragend", x, y);
      ghost.style.display = "none";
      drag = null;
    },
  };
}

class Recorder {
  constructor(page, dir) {
    this.page = page;
    this.dir = dir;
    this.frames = [];
    this.pos = { x: 0, y: 0 };
    this.dragging = false;
    this.mods = {};
  }

  async frame(ms = FRAME_MS) {
    const file = join(this.dir, `f${String(this.frames.length).padStart(4, "0")}.png`);
    await this.page.screenshot({ path: file });
    this.frames.push({ file, ms });
  }

  hold(ms) {
    return this.frame(ms);
  }

  async center(selector, dx = 150) {
    const r = await this.page.$eval(selector, (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top + b.height / 2 };
    });
    return { x: r.x + dx, y: r.y };
  }

  /** Moves the pointer with easing, recording a frame per step. */
  async moveTo({ x, y }, steps = 12) {
    const from = { ...this.pos };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.pos = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
      await this.page.evaluate(({ x, y }) => window.__gif.pointer(x, y), this.pos);
      if (this.dragging) await this.page.evaluate(({ x, y, m }) => window.__gif.dragOver(x, y, m), { ...this.pos, m: this.mods });
      await this.frame();
    }
  }

  async click(modifiers = []) {
    // mouse.click ignores modifiers, so hold them down on the keyboard.
    for (const m of modifiers) await this.page.keyboard.down(m);
    await this.page.mouse.click(this.pos.x, this.pos.y);
    for (const m of modifiers) await this.page.keyboard.up(m);
    await this.page.waitForTimeout(120);
    await this.frame(250);
  }

  async dragStart(selector, label) {
    await this.page.evaluate(({ s, l, x, y }) => window.__gif.dragStart(s, l, x, y), { s: selector, l: label, ...this.pos });
    this.dragging = true;
  }

  async setModifiers(mods, ms) {
    this.mods = mods;
    await this.page.evaluate(({ x, y, m }) => window.__gif.dragOver(x, y, m), { ...this.pos, m: mods });
    await this.page.waitForTimeout(50);
    await this.hold(ms);
  }

  async drop() {
    await this.page.evaluate(({ x, y, m }) => window.__gif.drop(x, y, m), { ...this.pos, m: this.mods });
    this.dragging = false;
    this.mods = {};
    await this.page.waitForTimeout(80);
    await this.frame(300); // progress bar while "jj" runs
    await this.page.waitForTimeout(450);
  }

  /** Writes an optimized GIF with ImageMagick. */
  save(name) {
    const args = ["-loop", "0"];
    for (const f of this.frames) args.push("-delay", String(Math.max(2, Math.round(f.ms / 10))), f.file);
    const out = join(root, "docs/images", name);
    args.push("-coalesce", "+dither", "+remap", "-layers", "Optimize", out);
    execFileSync("magick", args);
    return out;
  }
}

async function record(name, width, height, script) {
  const dir = await mkdtemp(join(tmpdir(), "vj-gif-"));
  const page = await open("graph", width, height, 2);
  await page.evaluate(installOverlay);
  const rec = new Recorder(page, dir);
  rec.pos = { x: width - 40, y: height - 40 };
  await page.evaluate(({ x, y }) => window.__gif.pointer(x, y), rec.pos);
  await script(rec);
  const out = rec.save(name);
  await page.close();
  await rm(dir, { recursive: true, force: true });
  console.log(`wrote ${out.replace(root + "/", "")} (${rec.frames.length} frames)`);
}

// Drag a stack onto another revision, show the ⌥ (this revision only) option, then drop.
await record("drag-rebase.gif", 360, 600, async (r) => {
  await r.hold(1200);
  await r.moveTo(await r.center(row("vnolmswp")), 14);
  await r.hold(400);
  await r.dragStart(row("vnolmswp"), "vnolmswp + 1 descendant");
  await r.moveTo(await r.center(row("ryzxvmos")), 18);
  await r.hold(1600);
  await r.setModifiers({ alt: true }, 1300);
  await r.setModifiers({}, 900);
  await r.drop();
  await r.hold(600);
  await r.moveTo({ x: 330, y: 560 }, 10);
  await r.hold(2600);
});

// Expand a revision, select two files, drag them onto another revision, then show the result.
await record("move-files.gif", 360, 640, async (r) => {
  await r.hold(1000);
  await r.moveTo(await r.center(row("ryzxvmos")), 14);
  await r.click();
  await r.page.waitForSelector(".file");
  await r.hold(700);
  await r.moveTo(await r.center(".file:nth-child(1)", 110), 8);
  await r.click(["Meta"]);
  await r.moveTo(await r.center(".file:nth-child(2)", 110), 6);
  await r.click(["Meta"]);
  await r.hold(500);
  await r.dragStart(".file:nth-child(2)", "2 files");
  await r.moveTo(await r.center(row("mzkroyxu")), 16);
  await r.hold(1800);
  await r.drop();
  await r.hold(900);
  await r.moveTo(await r.center(row("mzkroyxu")), 6);
  await r.click();
  await r.page.waitForTimeout(200);
  await r.hold(600);
  await r.moveTo({ x: 330, y: 610 }, 10);
  await r.hold(2600);
});

await close();
