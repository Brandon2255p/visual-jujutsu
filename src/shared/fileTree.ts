import type { ChangedFile } from "./types";

export interface FileTreeDir {
  kind: "dir";
  /** Shown name; a chain of single-child folders is compacted ("webview/src/graph"). */
  name: string;
  /** Full path from the repo root, used as the collapse key. */
  path: string;
  added: number;
  removed: number;
  children: FileTreeNode[];
}

export interface FileTreeFile {
  kind: "file";
  name: string;
  file: ChangedFile;
}

export type FileTreeNode = FileTreeDir | FileTreeFile;

export interface FileTreeRow {
  node: FileTreeNode;
  depth: number;
}

/** Changed files as folders, like the Explorer: folders first, then files, each by name. */
export function buildFileTree(files: ChangedFile[]): FileTreeNode[] {
  const root: FileTreeDir = { kind: "dir", name: "", path: "", added: 0, removed: 0, children: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.children.find((c): c is FileTreeDir => c.kind === "dir" && c.name === part);
      if (!next) {
        next = { kind: "dir", name: part, path: dir.path ? `${dir.path}/${part}` : part, added: 0, removed: 0, children: [] };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ kind: "file", name: parts[parts.length - 1], file });
  }
  return finish(root).children;
}

function finish(dir: FileTreeDir): FileTreeDir {
  dir.children = dir.children.map((c) => (c.kind === "dir" ? compact(finish(c)) : c));
  dir.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
  dir.added = dir.removed = 0;
  for (const c of dir.children) {
    dir.added += c.kind === "dir" ? c.added : c.file.added;
    dir.removed += c.kind === "dir" ? c.removed : c.file.removed;
  }
  return dir;
}

/** Merges a folder whose only child is a folder into one row. */
function compact(dir: FileTreeDir): FileTreeDir {
  const only = dir.children.length === 1 ? dir.children[0] : undefined;
  return only?.kind === "dir" ? { ...only, name: `${dir.name}/${only.name}` } : dir;
}

/** The rows to show, skipping the contents of collapsed folders. */
export function flattenFileTree(nodes: FileTreeNode[], isCollapsed: (path: string) => boolean, depth = 0): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === "dir" && !isCollapsed(node.path)) rows.push(...flattenFileTree(node.children, isCollapsed, depth + 1));
  }
  return rows;
}

/** Every folder's path, for collapse all. */
export function folderPaths(nodes: FileTreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "dir" ? [n.path, ...folderPaths(n.children)] : []));
}

/** The files inside a folder, at any depth. */
export function filesIn(dir: FileTreeDir): ChangedFile[] {
  return dir.children.flatMap((c) => (c.kind === "dir" ? filesIn(c) : [c.file]));
}
