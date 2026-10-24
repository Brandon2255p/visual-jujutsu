import type { GraphRow, NodeKind } from "../../../src/shared/types";

const LANE = 16;
/** Row heights for the two densities; must match --vj-row in styles.css. */
export const ROW_HEIGHT = { comfortable: 28, compact: 22 } as const;

export const laneX = (col: number) => 10 + col * LANE;
export const gutterWidth = (laneCount: number) => laneCount * LANE + 12;

/**
 * Draws one row's slice of the graph. The SVG is as tall as the row block,
 * so lanes running below the row also pass through expanded content.
 */
export function Gutter({ row, laneCount, kind, height = ROW_HEIGHT.comfortable }: { row: GraphRow; laneCount: number; kind: NodeKind; height?: number }) {
  const width = gutterWidth(laneCount);
  const ROW = height;
  const CENTER = height / 2;
  return (
    <svg class="gutter" width={width} height="100%">
      {row.segments.map((s, i) => {
        const x1 = laneX(s.fromCol);
        const x2 = laneX(s.toCol);
        const dashed = s.dashed ? "dashed" : undefined;
        if (s.from === "top") {
          return x1 === x2 ? (
            <line key={i} x1={x1} y1={0} x2={x2} y2={CENTER} />
          ) : (
            <path key={i} d={`M ${x1} 0 C ${x1} 8 ${x2} 6 ${x2} ${CENTER}`} />
          );
        }
        if (x1 === x2) return <line key={i} class={dashed} x1={x1} y1={CENTER} x2={x2} y2="100%" />;
        return (
          <g key={i}>
            <path d={`M ${x1} ${CENTER} C ${x1} ${CENTER + 8} ${x2} ${ROW - 6} ${x2} ${ROW}`} />
            <line x1={x2} y1={ROW} x2={x2} y2="100%" />
          </g>
        );
      })}
      <Node kind={kind} x={laneX(row.col)} y={CENTER} />
    </svg>
  );
}

export function Node({ kind, x, y }: { kind: NodeKind; x: number; y: number }) {
  switch (kind) {
    case "workingCopy":
      return <circle class="node-wc" cx={x} cy={y} r={6} />;
    case "immutable":
      return <path class="node-immutable" d={`M ${x} ${y - 5.5} L ${x + 5.5} ${y} L ${x} ${y + 5.5} L ${x - 5.5} ${y} Z`} />;
    case "conflict":
      return (
        <g>
          <circle class="node-conflict" cx={x} cy={y} r={6} />
          <path class="node-conflict-x" d={`M ${x - 2.5} ${y - 2.5} L ${x + 2.5} ${y + 2.5} M ${x + 2.5} ${y - 2.5} L ${x - 2.5} ${y + 2.5}`} />
        </g>
      );
    case "empty":
      return <circle class="node-empty" cx={x} cy={y} r={4.5} />;
    default:
      return <circle class="node-mutable" cx={x} cy={y} r={4.5} />;
  }
}

/** A standalone node icon for dialogs and lists. */
export function NodeIcon({ kind }: { kind: NodeKind }) {
  return (
    <svg class="mini-node" viewBox="0 0 14 14">
      <Node kind={kind} x={7} y={7} />
    </svg>
  );
}
