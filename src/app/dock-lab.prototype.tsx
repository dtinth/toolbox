// PROTOTYPE, throwaway. Issue #20: what should drag-to-dock feel like?
//
// Three variants of docking a Window into the Layout tree, on one page at
// `/?lab=dock`, switched with `?variant=A|B|C` or the bar at the bottom:
//
//   A  Edge zones.  Drag a window over a pane. Where you are in the pane picks
//                   the spot: near an edge splits, the middle adds a tab. A
//                   tinted box shows the pane you would get.
//   B  Compass.     Drag a window, and five buttons appear in each pane. Only a
//                   button is a target. An outline shows the pane you would get.
//   C  Place mode.  No drag at all. Press "Dock", then pick the spot with the
//                   keyboard or with big buttons. The tree itself moves to show
//                   the result before you commit.
//
// This file does not go to production as it is. When #20 is resolved, the
// winner is rewritten into the real code, and this file moves to a branch.

import { useEffect, useRef, useState } from "preact/hooks";
import {
  type LayoutNode,
  leaf,
  measure,
  minSize,
  pathOfTab,
  putTab,
  removeTab,
  split,
  splitPane,
} from "../runtime/layout-tree.ts";
import { LayoutView } from "../runtime/layout-view.tsx";

type Variant = "A" | "B" | "C";
const VARIANTS: Variant[] = ["A", "B", "C"];
const VARIANT_NAMES: Record<Variant, string> = {
  A: "Edge zones",
  B: "Compass",
  C: "Place mode",
};

type Side = "left" | "right" | "top" | "bottom";

type Target =
  | { kind: "tab"; pane: string }
  | { kind: "split"; pane: string; side: Side }
  | { kind: "root"; side: Side }
  /** Over the pane it came from: let go and nothing changes. */
  | { kind: "back" };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PaneRect {
  tabs: string[];
  rect: Rect;
}

interface Floating extends Rect {
  id: string;
}

const NAMES: Record<string, string> = {
  one: "One",
  two: "Two",
  three: "Three",
  four: "Four",
  five: "Five",
};

const START_TREE: LayoutNode = split("row", [leaf(["one"]), leaf(["two", "three"])], [0.5, 0.5]);
const START_FLOATS: Floating[] = [
  { id: "four", x: 40, y: 60, w: 220, h: 150 },
  { id: "five", x: 120, y: 140, w: 220, h: 150 },
];

// ---------------------------------------------------------------------------
// Geometry. The same arithmetic as LayoutView, so a preview box lands exactly
// where the pane would be drawn.

function paneRects(node: LayoutNode | null, box: Rect, out: PaneRect[] = []): PaneRect[] {
  if (node === null) {
    return out;
  }
  if (node.type === "leaf") {
    out.push({ tabs: node.tabs, rect: box });
    return out;
  }
  const row = node.direction === "row";
  const total = row ? box.w : box.h;
  const minima = node.children.map((c) => minSize(c, node.direction));
  const lengths = measure(node.sizes, minima, total);
  let at = 0;
  node.children.forEach((child, i) => {
    const len = lengths[i];
    paneRects(
      child,
      row
        ? { x: box.x + at, y: box.y, w: len, h: box.h }
        : { x: box.x, y: box.y + at, w: box.w, h: len },
      out,
    );
    at += len;
  });
  return out;
}

const contains = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

const dirOf = (side: Side) => (side === "left" || side === "right" ? "row" : "column");
const posOf = (side: Side) => (side === "left" || side === "top" ? "before" : "after");

/** The tree you get when `id` is dropped on `target`. */
function dropResult(tree: LayoutNode | null, id: string, target: Target): LayoutNode | null {
  if (target.kind === "back") {
    return tree;
  }
  const pruned = tree === null ? null : removeTab(tree, id);
  if (pruned === null) {
    return leaf([id]);
  }
  if (target.kind === "tab") {
    return putTab(pruned, target.pane, id);
  }
  if (target.kind === "root") {
    return splitPane(pruned, [], dirOf(target.side), leaf([id]), posOf(target.side));
  }
  const path = pathOfTab(pruned, target.pane);
  return path === null
    ? pruned
    : splitPane(pruned, path, dirOf(target.side), leaf([id]), posOf(target.side));
}

/** Where the dropped window would end up, in area pixels. */
function previewRect(tree: LayoutNode | null, id: string, target: Target, area: Rect): Rect | null {
  const result = dropResult(tree, id, target);
  return paneRects(result, area).find((p) => p.tabs.includes(id))?.rect ?? null;
}

function describe(target: Target | null): string {
  if (target === null) {
    return "nothing: it floats where you let go";
  }
  switch (target.kind) {
    case "back": {
      return "back where it was";
    }
    case "tab": {
      return `a tab beside ${NAMES[target.pane]}`;
    }
    case "split": {
      return `split ${target.side} of ${NAMES[target.pane]}`;
    }
    case "root": {
      return `the whole ${target.side} side`;
    }
    default: {
      return "";
    }
  }
}

// ---------------------------------------------------------------------------
// Hit testing for the two drag variants.

/** How close to the edge of the whole area counts as "dock to that side". */
const ROOT_EDGE = 28;
/** How deep into a pane, as a share of its size, an edge zone reaches. */
const PANE_EDGE = 0.25;
/** The tab bar of a pane. Dropping on it always adds a tab. */
const TAB_BAR = 36;

function zoneTarget(
  tree: LayoutNode | null,
  panes: PaneRect[],
  area: Rect,
  id: string,
  x: number,
  y: number,
): Target | null {
  if (!contains(area, x, y)) {
    return null;
  }
  if (tree === null) {
    return { kind: "root", side: "left" };
  }
  if (x < ROOT_EDGE) {
    return { kind: "root", side: "left" };
  }
  if (area.w - x < ROOT_EDGE) {
    return { kind: "root", side: "right" };
  }
  if (y < ROOT_EDGE) {
    return { kind: "root", side: "top" };
  }
  if (area.h - y < ROOT_EDGE) {
    return { kind: "root", side: "bottom" };
  }
  const pane = panes.find((p) => contains(p.rect, x, y));
  if (pane === undefined) {
    return null;
  }
  const other = pane.tabs.find((t) => t !== id);
  if (other === undefined) {
    return { kind: "back" };
  }
  const { rect } = pane;
  if (y - rect.y < TAB_BAR) {
    return { kind: "tab", pane: other };
  }
  const u = (x - rect.x) / rect.w;
  const v = (y - rect.y) / rect.h;
  const dist: [Side, number][] = [
    ["left", u],
    ["right", 1 - u],
    ["top", v],
    ["bottom", 1 - v],
  ];
  dist.sort((a, b) => a[1] - b[1]);
  return dist[0][1] < PANE_EDGE
    ? { kind: "split", pane: other, side: dist[0][0] }
    : { kind: "tab", pane: other };
}

/** The size of one compass button. Bigger than a fingertip on purpose. */
const BUTTON = 56;
const GAP = 8;

interface CompassButton {
  rect: Rect;
  target: Target;
  glyph: string;
}

function compassButtons(
  tree: LayoutNode | null,
  panes: PaneRect[],
  area: Rect,
  id: string,
): CompassButton[] {
  const at = (cx: number, cy: number): Rect => ({
    x: cx - BUTTON / 2,
    y: cy - BUTTON / 2,
    w: BUTTON,
    h: BUTTON,
  });
  if (tree === null) {
    return [
      {
        rect: at(area.w / 2, area.h / 2),
        target: { kind: "root", side: "left" },
        glyph: "▣",
      },
    ];
  }
  const out: CompassButton[] = [];
  const step = BUTTON + GAP;
  for (const pane of panes) {
    const cx = pane.rect.x + pane.rect.w / 2;
    const cy = pane.rect.y + pane.rect.h / 2;
    const other = pane.tabs.find((t) => t !== id);
    if (other === undefined) {
      out.push({ rect: at(cx, cy), target: { kind: "back" }, glyph: "↩" });
      continue;
    }
    out.push(
      { rect: at(cx, cy), target: { kind: "tab", pane: other }, glyph: "▣" },
      { rect: at(cx - step, cy), target: { kind: "split", pane: other, side: "left" }, glyph: "◧" },
      {
        rect: at(cx + step, cy),
        target: { kind: "split", pane: other, side: "right" },
        glyph: "◨",
      },
      { rect: at(cx, cy - step), target: { kind: "split", pane: other, side: "top" }, glyph: "⬒" },
      {
        rect: at(cx, cy + step),
        target: { kind: "split", pane: other, side: "bottom" },
        glyph: "⬓",
      },
    );
  }
  const edge = GAP + BUTTON / 2;
  out.push(
    { rect: at(edge, area.h / 2), target: { kind: "root", side: "left" }, glyph: "⇤" },
    { rect: at(area.w - edge, area.h / 2), target: { kind: "root", side: "right" }, glyph: "⇥" },
    { rect: at(area.w / 2, edge), target: { kind: "root", side: "top" }, glyph: "⤒" },
    { rect: at(area.w / 2, area.h - edge), target: { kind: "root", side: "bottom" }, glyph: "⤓" },
  );
  return out;
}

const sameTarget = (a: Target | null, b: Target | null) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// The page.

interface Drag {
  id: string;
  /** Where the window came from: a floating window, or a tab in the tree. */
  source: "float" | "tab";
  /** The pointer, in area pixels. */
  x: number;
  y: number;
  /** Where in the window the pointer grabbed it. */
  grabX: number;
  grabY: number;
  target: Target | null;
}

interface Place {
  id: string;
  /** Which pane is picked. One past the last pane means the whole layout. */
  pane: number;
  choice: Side | "centre";
}

const GHOST = { w: 220, h: 150 };
/** How far a tab must travel before a press turns into a drag. */
const DRAG_START = 10;

function readVariant(): Variant {
  const v = new URLSearchParams(globalThis.location.search).get("variant");
  return v === "B" || v === "C" ? v : "A";
}

function useAreaRect(ref: { current: HTMLElement | null }): Rect {
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      const b = el.getBoundingClientRect();
      setRect({ x: 0, y: 0, w: b.width, h: b.height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return rect;
}

export function DockLab() {
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [tree, setTree] = useState<LayoutNode | null>(START_TREE);
  const [floats, setFloats] = useState<Floating[]>(START_FLOATS);
  /** The last floating geometry of every window, kept while it is docked. */
  const geometry = useRef(new Map<string, Floating>(START_FLOATS.map((f) => [f.id, f])));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [lastDrop, setLastDrop] = useState("nothing yet");
  const mainRef = useRef<HTMLElement | null>(null);
  const area = useAreaRect(mainRef);
  const panes = paneRects(tree, area);

  // Handlers made at pointer-down must see the latest state.
  const live = useRef({ tree, floats, area, panes, variant, drag });
  live.current = { tree, floats, area, panes, variant, drag };

  const toArea = (e: PointerEvent) => {
    const b = mainRef.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  const targetAt = (id: string, x: number, y: number): Target | null => {
    const s = live.current;
    if (s.variant === "A") {
      return zoneTarget(s.tree, s.panes, s.area, id, x, y);
    }
    if (s.variant === "B") {
      const hit = compassButtons(s.tree, s.panes, s.area, id).find((b) => contains(b.rect, x, y));
      return hit?.target ?? null;
    }
    return null;
  };

  /** Follow the pointer until it lets go. Escape cancels. */
  const follow = (first: Drag, original: Floating | null) => {
    setDrag(first);
    let current = first;
    const onMove = (ev: PointerEvent) => {
      const p = toArea(ev);
      const target = targetAt(current.id, p.x, p.y);
      current = { ...current, ...p, target };
      setDrag(current);
      if (current.source === "float") {
        setFloats((fs) =>
          fs.map((f) =>
            f.id === current.id ? { ...f, x: p.x - current.grabX, y: p.y - current.grabY } : f,
          ),
        );
      }
    };
    const finish = (commit: boolean) => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
      globalThis.removeEventListener("pointercancel", onCancel);
      globalThis.removeEventListener("keydown", onKey, true);
      document.documentElement.style.userSelect = "";
      setDrag(null);
      const { id, target, x, y, grabX, grabY } = current;
      if (!commit) {
        if (original !== null) {
          setFloats((fs) => fs.map((f) => (f.id === id ? original : f)));
        }
        setLastDrop("cancelled, nothing changed");
        return;
      }
      setLastDrop(describe(target));
      if (target === null) {
        // Let go over nothing: it floats right there.
        const g: Floating = {
          id,
          x: x - grabX,
          y: y - grabY,
          w: original?.w ?? GHOST.w,
          h: original?.h ?? GHOST.h,
        };
        geometry.current.set(id, g);
        setTree((t) => (t === null ? null : removeTab(t, id)));
        setFloats((fs) => [...fs.filter((f) => f.id !== id), g]);
        return;
      }
      if (target.kind === "back") {
        return;
      }
      if (original !== null) {
        // Keep where it floated, so floating it again puts it back there.
        geometry.current.set(id, original);
      }
      setTree((t) => dropResult(t, id, target));
      setFloats((fs) => fs.filter((f) => f.id !== id));
    };
    const onUp = () => {
      finish(true);
    };
    const onCancel = () => {
      finish(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      }
    };
    document.documentElement.style.userSelect = "none";
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
    globalThis.addEventListener("pointercancel", onCancel);
    globalThis.addEventListener("keydown", onKey, true);
  };

  const raise = (id: string) => {
    setFloats((fs) => {
      const me = fs.find((f) => f.id === id);
      return me === undefined ? fs : [...fs.filter((f) => f.id !== id), me];
    });
  };

  const onTitlePointerDown = (e: PointerEvent, win: Floating) => {
    if (e.button !== 0 || (e.target as Element).closest("button") !== null) {
      return;
    }
    e.preventDefault();
    raise(win.id);
    const p = toArea(e);
    const original = { ...win };
    // In place mode (C) nothing is a target, so this drag only moves the window.
    follow(
      { id: win.id, source: "float", ...p, grabX: p.x - win.x, grabY: p.y - win.y, target: null },
      original,
    );
  };

  // A tab in the tree can be dragged out. LayoutView draws the tabs, so the
  // press is caught on the way down, before it reaches the tab button.
  const onAreaPointerDown = (e: PointerEvent) => {
    if (live.current.variant === "C" || e.button !== 0) {
      return;
    }
    const tabEl = (e.target as Element).closest('[role="tab"]');
    if (tabEl === null) {
      return;
    }
    const label = tabEl.textContent ?? "";
    const id = Object.keys(NAMES).find((k) => NAMES[k] === label);
    if (id === undefined) {
      return;
    }
    const start = toArea(e);
    const pending = (ev: PointerEvent) => {
      const p = toArea(ev);
      if (Math.hypot(p.x - start.x, p.y - start.y) < DRAG_START) {
        return;
      }
      stop();
      // The press became a drag: the click it would end with must not also
      // switch tabs.
      globalThis.addEventListener(
        "click",
        (c) => {
          c.stopPropagation();
          c.preventDefault();
        },
        { capture: true, once: true },
      );
      follow(
        {
          id,
          source: "tab",
          ...p,
          grabX: 40,
          grabY: 18,
          target: targetAt(id, p.x, p.y),
        },
        null,
      );
    };
    const stop = () => {
      globalThis.removeEventListener("pointermove", pending);
      globalThis.removeEventListener("pointerup", stop);
      globalThis.removeEventListener("pointercancel", stop);
    };
    globalThis.addEventListener("pointermove", pending);
    globalThis.addEventListener("pointerup", stop);
    globalThis.addEventListener("pointercancel", stop);
  };

  /** The control alternative to dragging out: float it where it was before. */
  const floatOut = (id: string) => {
    const g = geometry.current.get(id) ?? { id, x: 60, y: 80, ...GHOST };
    setTree((t) => (t === null ? null : removeTab(t, id)));
    setFloats((fs) => [...fs.filter((f) => f.id !== id), g]);
    setLastDrop(`floated back to ${Math.round(g.x)},${Math.round(g.y)}`);
  };

  // --- Place mode (variant C) ------------------------------------------------
  const placeTarget = (p: Place): Target => {
    const pane = panes[p.pane] as PaneRect | undefined;
    if (pane === undefined) {
      return { kind: "root", side: p.choice === "centre" ? "left" : p.choice };
    }
    const other = pane.tabs.find((t) => t !== p.id) ?? pane.tabs[0];
    return p.choice === "centre"
      ? { kind: "tab", pane: other }
      : { kind: "split", pane: other, side: p.choice };
  };

  const commitPlace = () => {
    if (place === null) {
      return;
    }
    const target = placeTarget(place);
    const win = floats.find((f) => f.id === place.id);
    if (win !== undefined) {
      geometry.current.set(win.id, win);
    }
    setTree((t) => dropResult(t, place.id, target));
    setFloats((fs) => fs.filter((f) => f.id !== place.id));
    setLastDrop(describe(target));
    setPlace(null);
  };

  const placeRef = useRef<HTMLDivElement | null>(null);
  const placing = place?.id;
  useEffect(() => {
    if (placing !== undefined) {
      placeRef.current?.focus();
    }
  }, [placing]);

  const onPlaceKey = (e: KeyboardEvent) => {
    if (place === null) {
      return;
    }
    const count = panes.length + 1;
    const keys: Record<string, Side> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "top",
      ArrowDown: "bottom",
    };
    if (e.key in keys) {
      e.preventDefault();
      setPlace({ ...place, choice: keys[e.key] });
    } else if (e.key === " " || e.key === "c") {
      e.preventDefault();
      setPlace({ ...place, choice: "centre" });
    } else if (e.key === "Tab") {
      e.preventDefault();
      setPlace({ ...place, pane: (place.pane + (e.shiftKey ? count - 1 : 1)) % count });
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitPlace();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPlace(null);
      setLastDrop("cancelled, nothing changed");
    }
  };

  // --- Variant switcher ------------------------------------------------------
  const switchTo = (v: Variant) => {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("variant", v);
    globalThis.history.replaceState(null, "", url);
    setVariant(v);
    setPlace(null);
  };
  const cycle = (by: number) => {
    const i = VARIANTS.indexOf(variant);
    switchTo(VARIANTS[(i + by + VARIANTS.length) % VARIANTS.length]);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (place !== null || drag !== null) {
        return;
      }
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable], hr") !== null) {
        return;
      }
      if (e.key === "ArrowLeft") {
        cycle(-1);
      }
      if (e.key === "ArrowRight") {
        cycle(1);
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  });

  // --- What to draw ----------------------------------------------------------
  const shownTree = place === null ? tree : dropResult(tree, place.id, placeTarget(place));
  const placeRect =
    place === null ? null : paneRects(shownTree, area).find((p) => p.tabs.includes(place.id))?.rect;
  const dragPreview =
    drag === null || drag.target === null ? null : previewRect(tree, drag.id, drag.target, area);
  const button =
    "h-11 min-w-11 rounded border border-toolbox-border px-3 text-sm hover:border-toolbox-border-light";

  const hint = {
    A: "Drag a window by its title, or a tab out of its pane. Near an edge splits; the middle or the tab bar adds a tab. Escape cancels.",
    B: "Drag a window by its title, or a tab out of its pane. Let go on a button to dock; anywhere else floats. Escape cancels.",
    C: "Press Dock on a floating window. Tab picks the pane, arrows pick the side, Space picks the middle, Enter places, Escape cancels.",
  }[variant];

  return (
    <div class="fixed inset-0 flex flex-col bg-toolbox-deepest text-toolbox-text">
      <style>{`.dock-lab [role="tab"] { touch-action: none; }`}</style>
      <header class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-toolbox-border px-3 py-2">
        <div class="font-bold">
          Dock lab {variant}: {VARIANT_NAMES[variant]}
        </div>
        <div class="text-sm text-toolbox-muted">{hint}</div>

        <div class="order-last w-full truncate text-sm">
          <span class="text-toolbox-muted">{drag === null ? "Last drop: " : "Let go for: "}</span>
          <span class="text-toolbox-accent">
            {drag === null ? lastDrop : describe(drag.target)}
          </span>
        </div>
        <button
          type="button"
          class={`${button} ml-auto`}
          onClick={() => {
            setTree(START_TREE);
            setFloats(START_FLOATS);
            geometry.current = new Map(START_FLOATS.map((f) => [f.id, f]));
            setPlace(null);
            setLastDrop("nothing yet");
          }}
        >
          Start again
        </button>
      </header>
      <main
        ref={mainRef}
        class="dock-lab relative min-h-0 flex-1 overflow-hidden"
        onPointerDownCapture={onAreaPointerDown}
      >
        <LayoutView
          root={shownTree}
          labelOf={(tab) => NAMES[tab] ?? tab}
          renderTab={(tab) =>
            place?.id === tab ? (
              <div class="text-toolbox-accent">{NAMES[tab]} goes here.</div>
            ) : (
              <div class="flex flex-col gap-2">
                <div class="text-toolbox-accent">{NAMES[tab]}</div>
                <div class="text-sm text-toolbox-muted">
                  {variant === "C"
                    ? "Press Float to take it out."
                    : "Drag the tab out to float it, or press Float."}
                </div>
                <div>
                  <button
                    type="button"
                    class={button}
                    onClick={() => {
                      floatOut(tab);
                    }}
                  >
                    Float
                  </button>
                </div>
              </div>
            )
          }
          onChange={(next) => {
            if (place === null) {
              setTree(next);
            }
          }}
          empty={<div class="text-sm">Nothing is docked.</div>}
        />

        {placeRect === null || placeRect === undefined ? null : (
          <div
            class="pointer-events-none absolute z-20 rounded border-2 border-toolbox-accent"
            style={{ left: placeRect.x, top: placeRect.y, width: placeRect.w, height: placeRect.h }}
          />
        )}

        {floats.map((win, z) => {
          const dragging = drag?.id === win.id;
          return (
            <div
              key={win.id}
              class="absolute flex flex-col overflow-hidden rounded border border-toolbox-border-light bg-toolbox-surface shadow-lg"
              style={{
                left: win.x,
                top: win.y,
                width: win.w,
                height: win.h,
                zIndex: dragging ? 40 : 10 + z,
                opacity: (dragging && drag.target !== null) || place?.id === win.id ? 0.3 : 1,
              }}
            >
              <div
                class="flex h-11 shrink-0 cursor-grab touch-none items-center gap-2 bg-toolbox-content pl-3 select-none"
                onPointerDown={(e) => {
                  onTitlePointerDown(e, win);
                }}
              >
                <span class="flex-1">{NAMES[win.id]}</span>
                {variant === "C" ? (
                  <button
                    type="button"
                    class="h-11 px-3 text-sm text-toolbox-accent"
                    onClick={() => {
                      setPlace({ id: win.id, pane: 0, choice: "centre" });
                    }}
                  >
                    Dock
                  </button>
                ) : null}
              </div>
              <div class="p-3 text-sm text-toolbox-muted">A floating window.</div>
            </div>
          );
        })}

        {drag !== null && drag.source === "tab" ? (
          <div
            class="pointer-events-none absolute z-40 flex flex-col overflow-hidden rounded border border-toolbox-accent bg-toolbox-surface"
            style={{
              left: drag.x - drag.grabX,
              top: drag.y - drag.grabY,
              width: GHOST.w,
              height: GHOST.h,
              opacity: drag.target === null ? 0.9 : 0.45,
            }}
          >
            <div class="flex h-11 items-center bg-toolbox-content pl-3">{NAMES[drag.id]}</div>
          </div>
        ) : null}

        {dragPreview === null ? null : (
          <div
            class={`pointer-events-none absolute z-30 flex items-center justify-center rounded text-sm ${
              variant === "A"
                ? "border border-toolbox-accent bg-toolbox-accent/25 text-toolbox-accent"
                : "border-2 border-dashed border-toolbox-accent text-toolbox-accent"
            }`}
            style={{
              left: dragPreview.x,
              top: dragPreview.y,
              width: dragPreview.w,
              height: dragPreview.h,
            }}
          >
            {describe(drag!.target)}
          </div>
        )}

        {variant === "B" && drag !== null
          ? compassButtons(tree, panes, area, drag.id).map((b) => {
              const on = sameTarget(b.target, drag.target);
              return (
                <div
                  key={JSON.stringify(b.target)}
                  class={`pointer-events-none absolute z-50 flex items-center justify-center rounded-lg border text-2xl ${
                    on
                      ? "border-toolbox-accent bg-toolbox-accent text-toolbox-deepest"
                      : "border-toolbox-border-light bg-toolbox-content/90 text-toolbox-text"
                  }`}
                  style={{ left: b.rect.x, top: b.rect.y, width: b.rect.w, height: b.rect.h }}
                >
                  {b.glyph}
                </div>
              );
            })
          : null}
      </main>

      {place === null ? null : (
        <div
          ref={placeRef}
          tabIndex={-1}
          onKeyDown={onPlaceKey}
          role="toolbar"
          aria-label={`Dock ${NAMES[place.id]}`}
          class="fixed right-0 bottom-16 left-0 z-50 mx-auto flex w-fit max-w-[calc(100%-32px)] flex-wrap items-center justify-center gap-2 rounded-lg border border-toolbox-accent bg-toolbox-surface p-2 shadow-lg focus:outline-none"
        >
          <div class="w-full text-center text-sm">
            Dock {NAMES[place.id]}:{" "}
            <span class="text-toolbox-accent">
              {place.pane < panes.length
                ? `pane ${place.pane + 1} of ${panes.length}`
                : "the whole layout"}
              , {describe(placeTarget(place))}
            </span>
          </div>
          <button
            type="button"
            class={button}
            onClick={() => {
              setPlace({ ...place, pane: (place.pane + panes.length) % (panes.length + 1) });
            }}
          >
            Prev pane
          </button>
          {(["left", "top", "centre", "bottom", "right"] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={place.choice === c}
              disabled={c === "centre" && place.pane >= panes.length}
              class={`${button} ${place.choice === c ? "border-toolbox-accent text-toolbox-accent" : ""} disabled:opacity-30`}
              onClick={() => {
                setPlace({ ...place, choice: c });
              }}
            >
              {{ left: "←", top: "↑", centre: "●", bottom: "↓", right: "→" }[c]}
            </button>
          ))}
          <button
            type="button"
            class={button}
            onClick={() => {
              setPlace({ ...place, pane: (place.pane + 1) % (panes.length + 1) });
            }}
          >
            Next pane
          </button>
          <button
            type="button"
            class={`${button} border-toolbox-accent text-toolbox-accent`}
            onClick={commitPlace}
          >
            Place
          </button>
          <button
            type="button"
            class={button}
            onClick={() => {
              setPlace(null);
              setLastDrop("cancelled, nothing changed");
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {drag === null ? <PrototypeSwitcher variant={variant} onCycle={cycle} /> : null}
    </div>
  );
}

/**
 * The bar for flipping between variants. Not part of any design being judged.
 * It stays in production on purpose: the page is only reachable at
 * `/?lab=dock`, and the variants are meant to be tried on a phone.
 */
function PrototypeSwitcher({
  variant,
  onCycle,
}: {
  variant: Variant;
  onCycle: (by: number) => void;
}) {
  const arrow = "h-11 w-11 rounded-full text-lg hover:bg-white/10";
  return (
    <div class="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white px-1 text-sm text-black shadow-xl">
      <button
        type="button"
        class={arrow}
        aria-label="Previous variant"
        onClick={() => {
          onCycle(-1);
        }}
      >
        ‹
      </button>
      <span class="px-2 whitespace-nowrap">
        {variant} ({VARIANT_NAMES[variant]})
      </span>
      <button
        type="button"
        class={arrow}
        aria-label="Next variant"
        onClick={() => {
          onCycle(1);
        }}
      >
        ›
      </button>
    </div>
  );
}
