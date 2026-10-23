import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../icons";
import { cls } from "../util";

export type MenuEntry =
  | "-"
  | {
      label: string;
      kb?: string;
      disabled?: boolean;
      run?: () => void;
      children?: MenuEntry[];
    };

interface Props {
  entries: MenuEntry[];
  x: number;
  y: number;
  onClose: () => void;
  /** Width of the parent menu item, so a submenu can flip to the left. */
  flipWidth?: number;
  root?: boolean;
}

/** VS Code-style context menu with submenus and keyboard navigation. */
export function Menu({ entries, x, y, onClose, flipWidth = 0, root = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number; w: number } | null>(null);

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - 4) left = Math.max(4, flipWidth ? x - flipWidth - r.width + 8 : window.innerWidth - r.width - 4);
    if (top + r.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    if (!root) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".menu")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    ref.current?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, []);

  const selectable = entries.map((e, i) => (e !== "-" && !e.disabled ? i : -1)).filter((i) => i >= 0);

  const openSub = (i: number, el: HTMLElement) => {
    const e = entries[i];
    if (e === "-" || !e.children) return setSub(null);
    const r = el.getBoundingClientRect();
    setSub({ index: i, x: r.right - 4, y: r.top - 5, w: r.width });
  };

  const activate = (i: number, el?: HTMLElement | null) => {
    const e = entries[i];
    if (e === "-" || e.disabled) return;
    if (e.children) {
      if (el) openSub(i, el);
      return;
    }
    onClose();
    e.run?.();
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (sub && (ev.key === "ArrowLeft" || ev.key === "Escape") && !root) return;
    const at = selectable.indexOf(active);
    if (ev.key === "ArrowDown") setActive(selectable[(at + 1) % selectable.length]);
    else if (ev.key === "ArrowUp") setActive(selectable[(at - 1 + selectable.length) % selectable.length]);
    else if (ev.key === "Enter" || ev.key === "ArrowRight") {
      const el = ref.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
      if (active >= 0) activate(active, el);
    } else return;
    ev.preventDefault();
    ev.stopPropagation();
  };

  return (
    <>
      <div class="menu" ref={ref} tabIndex={-1} style={{ left: `${pos.left}px`, top: `${pos.top}px` }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
        {entries.map((e, i) =>
          e === "-" ? (
            <div key={i} class="menu-sep" />
          ) : (
            <div
              key={i}
              data-i={i}
              class={cls("menu-item", active === i && "active", e.disabled && "disabled")}
              onMouseEnter={(ev) => {
                if (e.disabled) return;
                setActive(i);
                openSub(i, ev.currentTarget as HTMLElement);
              }}
              onClick={(ev) => activate(i, ev.currentTarget as HTMLElement)}
            >
              <span class="label">{e.label}</span>
              {e.kb && <span class="kb">{e.kb}</span>}
              {e.children && <Icon name="chevron-right" />}
            </div>
          ),
        )}
      </div>
      {sub && entries[sub.index] !== "-" && (
        <Menu
          entries={(entries[sub.index] as { children: MenuEntry[] }).children}
          x={sub.x}
          y={sub.y}
          flipWidth={sub.w}
          onClose={onClose}
          root={false}
        />
      )}
    </>
  );
}
