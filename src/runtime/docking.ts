// Docking: where a dragged Window can go in the Layout tree, and what the tree
// looks like once it gets there.
//
// The interaction is the "slim compass" settled in issue #20. While a Window is
// dragged, the Pane under the pointer shows five buttons — a tab in the middle,
// a split on each side — and an edge of the layout shows one button when the
// pointer comes near it. Only a button is a target. Let go anywhere else and the
// Window floats right there.
//
// Everything here is pure: geometry in, geometry out. The pointer, the DOM and
// the overlay live in the host.

import {
  type LayoutNode,
  leaf,
  measure,
  minSize,
  pathOfTab,
  putTab,
  removeTab,
  splitPane,
} from "./layout-tree.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A Pane and the rectangle it gets. */
export interface PaneRect {
  tabs: string[];
  activeTab: number;
  rect: Rect;
}

export type Side = "left" | "right" | "top" | "bottom";

/**
 * Where a dragged Window would land.
 *
 * A Pane is named by a tab it holds, not by a path: taking the dragged tab out
 * of the tree can collapse a split, and a path taken before that can then point
 * at the wrong Pane. A tab id survives the repair.
 */
export type DockTarget =
  /** In front, as a tab of the Pane that holds `pane`. */
  | { kind: "tab"; pane: string }
  /** In a new Pane on one side of the Pane that holds `pane`. */
  | { kind: "split"; pane: string; side: Side }
  /** In a new Pane along one whole edge of the layout. */
  | { kind: "edge"; side: Side }
  /** Back where it came from: nothing changes. */
  | { kind: "back" };

/**
 * Lay the tree out in `box`, and give every Pane its rectangle, in tree order.
 *
 * The same arithmetic as `LayoutView`, which places children by the fractions
 * `measure` gives. So a rectangle from here is where that Pane is drawn.
 */
export function paneRects(node: LayoutNode | null, box: Rect, out: PaneRect[] = []): PaneRect[] {
  if (node === null) {
    return out;
  }
  if (node.type === "leaf") {
    out.push({ tabs: node.tabs, activeTab: node.activeTab, rect: box });
    return out;
  }
  const row = node.direction === "row";
  const total = row ? box.w : box.h;
  const minima = node.children.map((child) => minSize(child, node.direction));
  const lengths = measure(node.sizes, minima, total);
  let at = 0;
  for (const [i, child] of node.children.entries()) {
    const length = lengths[i];
    paneRects(
      child,
      row
        ? { x: box.x + at, y: box.y, w: length, h: box.h }
        : { x: box.x, y: box.y + at, w: box.w, h: length },
      out,
    );
    at += length;
  }
  return out;
}

const directionOf = (side: Side) => (side === "left" || side === "right" ? "row" : "column");
const positionOf = (side: Side) => (side === "left" || side === "top" ? "before" : "after");

/**
 * The tree you get when the Window `id` is docked at `target`.
 *
 * A Window that is docked already moves; it is never copied. The tree stays
 * the same when the target names a Pane that is not there.
 */
export function dock(root: LayoutNode | null, id: string, target: DockTarget): LayoutNode | null {
  if (target.kind === "back") {
    return root;
  }
  const pruned = root === null ? null : removeTab(root, id);
  if (pruned === null) {
    return target.kind === "edge" ? leaf([id]) : root;
  }
  switch (target.kind) {
    case "tab": {
      return pathOfTab(pruned, target.pane) === null ? root : putTab(pruned, target.pane, id);
    }
    case "edge": {
      return splitPane(pruned, [], directionOf(target.side), leaf([id]), positionOf(target.side));
    }
    case "split": {
      const path = pathOfTab(pruned, target.pane);
      return path === null
        ? root
        : splitPane(pruned, path, directionOf(target.side), leaf([id]), positionOf(target.side));
    }
    default: {
      return root;
    }
  }
}

/** The rectangle `id` would get if it were docked at `target`. */
export function previewRect(
  root: LayoutNode | null,
  id: string,
  target: DockTarget,
  area: Rect,
): Rect | null {
  const after = target.kind === "back" ? root : dock(root, id, target);
  return paneRects(after, area).find((p) => p.tabs.includes(id))?.rect ?? null;
}

/**
 * The size of one compass button, in pixels. Larger than the 44 a fingertip
 * needs, because the finger is moving when it lets go.
 */
export const COMPASS_BUTTON = 56;
const GAP = 8;

/** How near an edge of the layout the pointer must be for its button to show. */
export const EDGE_NEAR = 96;

export interface CompassButton {
  rect: Rect;
  target: DockTarget;
}

const contains = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

function centredAt(cx: number, cy: number): Rect {
  return {
    x: cx - COMPASS_BUTTON / 2,
    y: cy - COMPASS_BUTTON / 2,
    w: COMPASS_BUTTON,
    h: COMPASS_BUTTON,
  };
}

/**
 * The compass buttons to show while `id` is dragged with the pointer at x, y,
 * in the coordinates of `area`.
 *
 * Only the Pane under the pointer shows its buttons, and an edge of the layout
 * shows its button only when the pointer is within `EDGE_NEAR` of it. Showing
 * every Pane's buttons at once worked, but it was a lot to look at, and on a
 * phone the edge buttons crowded the Pane buttons.
 */
export function compassAt(
  root: LayoutNode | null,
  area: Rect,
  id: string,
  x: number,
  y: number,
): CompassButton[] {
  if (!contains(area, x, y)) {
    return [];
  }
  if (root === null) {
    return [
      {
        rect: centredAt(area.x + area.w / 2, area.y + area.h / 2),
        target: { kind: "edge", side: "left" },
      },
    ];
  }

  const out: CompassButton[] = [];
  const pane = paneRects(root, area).find((p) => contains(p.rect, x, y));
  if (pane !== undefined) {
    out.push(...paneButtons(pane, id));
  }

  const step = GAP + COMPASS_BUTTON / 2;
  const midX = area.x + area.w / 2;
  const midY = area.y + area.h / 2;
  const edges: [Side, boolean, number, number][] = [
    ["left", x - area.x < EDGE_NEAR, area.x + step, midY],
    ["right", area.x + area.w - x < EDGE_NEAR, area.x + area.w - step, midY],
    ["top", y - area.y < EDGE_NEAR, midX, area.y + step],
    ["bottom", area.y + area.h - y < EDGE_NEAR, midX, area.y + area.h - step],
  ];
  for (const [side, near, cx, cy] of edges) {
    if (near) {
      out.push({ rect: centredAt(cx, cy), target: { kind: "edge", side } });
    }
  }
  return out;
}

function paneButtons(pane: PaneRect, id: string): CompassButton[] {
  const cx = pane.rect.x + pane.rect.w / 2;
  const cy = pane.rect.y + pane.rect.h / 2;
  const other = pane.tabs.find((t) => t !== id);
  if (other === undefined) {
    return [{ rect: centredAt(cx, cy), target: { kind: "back" } }];
  }
  const step = COMPASS_BUTTON + GAP;
  const sides: [Side, number, number][] = [
    ["left", -step, 0],
    ["right", step, 0],
    ["top", 0, -step],
    ["bottom", 0, step],
  ];
  return [
    { rect: centredAt(cx, cy), target: { kind: "tab", pane: other } },
    ...sides.map(([side, dx, dy]) => ({
      rect: centredAt(cx + dx, cy + dy),
      target: { kind: "split", pane: other, side } as DockTarget,
    })),
  ];
}

/** The target under the pointer, or null when the pointer is on no button. */
export function targetAt(buttons: CompassButton[], x: number, y: number): DockTarget | null {
  return buttons.find((b) => contains(b.rect, x, y))?.target ?? null;
}

/** Whether this Window is docked: its id is in the tree. There is no flag. */
export function isDocked(root: LayoutNode | null, id: string): boolean {
  return root !== null && pathOfTab(root, id) !== null;
}

/** The Pane that holds this Window, or null when it floats. */
export function paneOf(root: LayoutNode | null, id: string, area: Rect): PaneRect | null {
  return paneRects(root, area).find((p) => p.tabs.includes(id)) ?? null;
}
