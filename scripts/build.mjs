import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const configs = [
  {
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: true,
  },
  {
    entryPoints: ["webview/src/main.tsx"],
    outfile: "dist/webview.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "preact",
    sourcemap: true,
    loader: { ".css": "text" },
  },
];

if (watch) {
  for (const c of configs) (await esbuild.context(c)).watch();
  console.log("watching…");
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  console.log("built dist/extension.js and dist/webview.js");
}
