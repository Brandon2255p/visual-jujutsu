import { describe, expect, it } from "vitest";
import { buildFileTree, filesIn, flattenFileTree, folderPaths, type FileTreeDir } from "../src/shared/fileTree";
import type { ChangedFile } from "../src/shared/types";

const f = (path: string, added = 1, removed = 0): ChangedFile => ({ path, status: "modified", added, removed, conflict: false });

const files = [
  f("package.json", 12),
  f("webview/src/graph/Gutter.tsx", 4, 2),
  f("src/jj/repo.ts", 4, 3),
  f("webview/src/graph/FileTree.tsx", 96),
  f("src/shared/fileTree.ts", 88),
  f("CHANGELOG.md", 6),
  f("test/fileTree.test.ts", 120),
];
const show = (rows: ReturnType<typeof flattenFileTree>) => rows.map((r) => `${"  ".repeat(r.depth)}${r.node.name}${r.node.kind === "dir" ? "/" : ""}`);

describe("file tree", () => {
  it("puts folders first, compacts single-child chains and sorts by name", () => {
    expect(show(flattenFileTree(buildFileTree(files), () => false))).toEqual([
      "src/",
      "  jj/",
      "    repo.ts",
      "  shared/",
      "    fileTree.ts",
      "test/",
      "  fileTree.test.ts",
      "webview/src/graph/",
      "  FileTree.tsx",
      "  Gutter.tsx",
      "CHANGELOG.md",
      "package.json",
    ]);
  });

  it("adds up lines per folder and keys folders by full path", () => {
    const tree = buildFileTree(files);
    const src = tree[0] as FileTreeDir;
    expect([src.added, src.removed]).toEqual([92, 3]);
    const graph = tree[2] as FileTreeDir;
    expect(graph.path).toBe("webview/src/graph");
    expect(filesIn(graph).map((x) => x.path)).toEqual(["webview/src/graph/FileTree.tsx", "webview/src/graph/Gutter.tsx"]);
    expect(folderPaths(tree)).toEqual(["src", "src/jj", "src/shared", "test", "webview/src/graph"]);
  });

  it("hides the contents of collapsed folders", () => {
    const rows = flattenFileTree(buildFileTree(files), (p) => p === "src" || p === "webview/src/graph");
    expect(show(rows)).toEqual(["src/", "test/", "  fileTree.test.ts", "webview/src/graph/", "CHANGELOG.md", "package.json"]);
  });

  it("keeps a folder that holds both files and a folder", () => {
    const rows = flattenFileTree(buildFileTree([f("a/b/c.ts"), f("a/d.ts")]), () => false);
    expect(show(rows)).toEqual(["a/", "  b/", "    c.ts", "  d.ts"]);
  });
});
