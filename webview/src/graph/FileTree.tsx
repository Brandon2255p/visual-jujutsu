import type { HTMLAttributes, JSX } from "preact";
import type { ChangedFile, FileView } from "../../../src/shared/types";
import { buildFileTree, flattenFileTree, type FileTreeDir } from "../../../src/shared/fileTree";
import { Icon } from "../icons";
import { cls, splitPath } from "../util";

/** Each folder level indents its rows by this much. */
const INDENT = 12;
/** Grip (12px) and gap (6px) before the file icon or chevron. */
const GRIP = 18;

/**
 * A revision's changed files, as a flat list or under their folders.
 * The caller renders file rows; this renders folder rows and the indentation.
 */
export function FileTree(props: {
  files: ChangedFile[];
  view: FileView;
  /** Left padding of a top-level row. */
  indent: number;
  /** Whether rows start with a drag grip (graph) or not (evolution log). */
  grip?: boolean;
  isCollapsed: (dir: string) => boolean;
  onToggle: (dir: string) => void;
  renderFile: (file: ChangedFile, name: string, dir: string, indent: number, guides: JSX.Element[]) => JSX.Element;
  /** Drag and context-menu handlers for a folder row. */
  folderProps?: (dir: FileTreeDir) => HTMLAttributes<HTMLDivElement>;
}) {
  const { indent, grip = false } = props;
  if (props.view === "list") {
    return (
      <>
        {props.files.map((f) => {
          const { name, dir } = splitPath(f.path);
          return props.renderFile(f, name, dir, indent, []);
        })}
      </>
    );
  }
  // A guide runs through every row below a folder, at the centre of its chevron.
  const guides = (depth: number) =>
    Array.from({ length: depth }, (_, i) => <span class="tree-guide" style={{ left: `${indent + i * INDENT + (grip ? GRIP : 0) + 7}px` }} />);
  return (
    <>
      {flattenFileTree(buildFileTree(props.files), props.isCollapsed).map(({ node, depth }) => {
        const pad = indent + depth * INDENT;
        if (node.kind === "file") return props.renderFile(node.file, node.name, "", pad, guides(depth));
        const collapsed = props.isCollapsed(node.path);
        return (
          <div
            key={`dir:${node.path}`}
            class={cls("file", "folder", collapsed && "collapsed")}
            style={{ paddingLeft: `${pad}px` }}
            title={node.path}
            {...props.folderProps?.(node)}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle(node.path);
            }}
          >
            {guides(depth)}
            {grip && <Icon name="grip" class="grip" />}
            <Icon name={collapsed ? "chevron-right" : "chevron-down"} />
            <span class="folder-name">{node.name}</span>
            <span class="add">+{node.added}</span>
            <span class="del">−{node.removed}</span>
            <span class="st" />
          </div>
        );
      })}
    </>
  );
}
