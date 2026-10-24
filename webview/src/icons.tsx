// Stroke icons matching the Figma icon set (24px viewBox, drawn at 16px).
const cloud = "M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284";

const paths = {
  "chevron-right": ["m9 18 6-6-6-6"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-left": ["m15 18-6-6 6-6"],
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  redo: ["m15 14 5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  refresh: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
  fetch: ["M12 13v8l-4-4", "m12 21 4-4", cloud],
  push: ["M12 13v8", "m8 17 4-4 4 4", cloud],
  settings: ["M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12", "c:12:12:3"],
  "pull-request": ["c:18:18:3", "c:6:6:3", "M13 6h3a2 2 0 0 1 2 2v7", "M6 9v12"],
  history: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2"],
  graph: ["M21 12h-8", "M21 6H8", "M21 18h-8", "M3 6v4c0 1.1.9 2 2 2h3", "M3 10v6c0 1.1.9 2 2 2h3"],
  filter: ["M22 3H2l8 9.46V19l4 2v-8.54L22 3z"],
  search: ["c:11:11:8", "m21 21-4.3-4.3"],
  file: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4"],
  more: ["c:5:12:1", "c:12:12:1", "c:19:12:1"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  warning: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
  check: ["M20 6 9 17l-5-5"],
  person: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "c:12:7:4"],
  info: ["c:12:12:10", "M12 16v-4", "M12 8h.01"],
  edit: ["M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"],
  plus: ["M5 12h14", "M12 5v14"],
  terminal: ["m4 17 6-6-6-6", "M12 19h8"],
  rebase: ["m21 16-4 4-4-4", "M17 20V4", "m3 8 4-4 4 4", "M7 4v16"],
  "move-file": ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M8 14h8", "m13 11 3 3-3 3"],
  grip: ["c:9:5:1", "c:9:12:1", "c:9:19:1", "c:15:5:1", "c:15:12:1", "c:15:19:1"],
  "x-circle": ["c:12:12:10", "m15 9-6 6", "m9 9 6 6"],
  clock: ["c:12:12:10", "M12 6v6l4 2"],
  eye: ["M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z", "c:12:12:3"],
  copy: ["M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2", "r:8:8:14:14"],
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, class: cls }: { name: IconName; class?: string }) {
  return (
    <svg class={`icon ${cls ?? ""}`} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name].map((d) => {
        if (d.startsWith("c:")) {
          const [, cx, cy, r] = d.split(":");
          return <circle cx={cx} cy={cy} r={r} />;
        }
        if (d.startsWith("r:")) {
          const [, x, y, w, h] = d.split(":");
          return <rect x={x} y={y} width={w} height={h} rx="2" />;
        }
        return <path d={d} />;
      })}
    </svg>
  );
}
