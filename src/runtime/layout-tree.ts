// Layout tree: the geometry engine under docking. A tree of splits and panes,
// sized by ratio rather than by pixel, so one tree fits every viewport.
//
// Floating Windows are not in this tree. They are drawn above it.

/**
 * A pane: a stack of tabs sharing one rectangle. The strings are scoped Slot
 * ids (`${instanceId}::${originalId}`), the same keys the window manager uses.
 *
 * A pane is a stack and not a single Window on purpose. A dormant Window is
 * then only a tab that is not drawn: the pane keeps its rectangle, and the tree
 * does not move. See issue #19.
 */
export interface LayoutLeaf {
  type: "leaf";
  /** The tabs in this pane, in tab order. A normalised tree has no empty pane. */
  tabs: string[];
  /** Which tab is in front. Always a legal index into `tabs`. */
  activeTab: number;
}

/** Which way a split puts its children. A `row` divides the width. */
export type SplitDirection = "row" | "column";

/**
 * A split: two or more children in a line, with a divider between each pair.
 *
 * `sizes` holds relative weights that add up to 1, never pixels. Pixels would
 * need arithmetic after every viewport change, and the survey of prior art
 * (docs/research/dockable-layouts-prior-art.md) shows the pixel approach is the
 * weaker one.
 */
export interface LayoutSplit {
  type: "split";
  direction: SplitDirection;
  children: LayoutNode[];
  /** One weight per child. The weights add up to 1. */
  sizes: number[];
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

/** Where a new pane goes in relation to the pane it splits. */
export type SplitPosition = "before" | "after";

/** The address of a node: the child index to take at each level, from the root. */
export type LayoutPath = number[];

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/**
 * Make the weights add up to 1.
 *
 * A weight that is not a positive number makes the whole array suspect — a
 * corrupt stored layout must not put a pane at zero width, where the user
 * cannot see it or drag it back. So one bad weight sends every child to an
 * equal share.
 */
function toWeights(sizes: number[], count: number): number[] {
  const usable =
    sizes.length === count && sizes.every((s) => Number.isFinite(s) && s > 0)
      ? sizes
      : Array.from({ length: count }, () => 1);
  const total = sum(usable);
  return usable.map((s) => s / total);
}

/** Build a pane from its tabs. */
export function leaf(tabs: string[], activeTab = 0): LayoutLeaf {
  return { type: "leaf", tabs: [...tabs], activeTab };
}

/** Build a split. Omit `sizes` to give every child an equal share. */
export function split(
  direction: SplitDirection,
  children: LayoutNode[],
  sizes?: number[],
): LayoutSplit {
  return {
    type: "split",
    direction,
    children: [...children],
    sizes: toWeights(sizes ?? [], children.length),
  };
}

/**
 * Turn the weights into pixel lengths for a container of length `total`.
 *
 * A pane that would fall under its minimum is lifted to it, and the room comes
 * out of the panes that have room to spare. This repeats, because lifting one
 * pane can push another under its own minimum.
 *
 * **When the minimums cannot all fit**, every pane shrinks by the same ratio
 * instead. The minimum is a floor for a drag, not a floor for the screen: a
 * small screen is not an error by the user, and a layout that overflows would
 * hide whole panes with no way to reach them. Panes stay visible, in order, and
 * in proportion to what they asked for. The weights are untouched, so the
 * layout comes back exactly as it was when the screen grows again.
 */
export function measure(sizes: number[], minima: number[], total: number): number[] {
  const count = sizes.length;
  if (count === 0) {
    return [];
  }
  const mins = minima.map((m) => (Number.isFinite(m) && m > 0 ? m : 0));
  const minTotal = sum(mins);
  if (minTotal >= total) {
    return minTotal === 0 ? mins.map(() => total / count) : mins.map((m) => (total * m) / minTotal);
  }

  const weights = toWeights(sizes, count);
  const out = Array.from<number>({ length: count }).fill(0);
  const free = new Set(weights.keys());
  let room = total;
  let pinned = true;
  while (pinned) {
    pinned = false;
    const weightLeft = sum([...free].map((i) => weights[i]));
    for (const i of free) {
      const share = (room * weights[i]) / weightLeft;
      if (share < mins[i]) {
        out[i] = mins[i]!;
        room -= mins[i];
        free.delete(i);
        pinned = true;
      }
    }
  }
  const weightLeft = sum([...free].map((i) => weights[i]));
  for (const i of free) {
    out[i] = (room * weights[i]) / weightLeft;
  }
  return out;
}

/**
 * Move the divider that sits after child `index` by `deltaPx`, and give back
 * the new weights.
 *
 * The pane on the side the divider moves towards grows. The panes on the other
 * side shrink in turn: the nearest one gives what it can down to its minimum,
 * then the next one, and so on. A drag therefore keeps going when its immediate
 * neighbour is already as small as it may get, which is what Lumino does.
 */
export function dragDivider(
  sizes: number[],
  minima: number[],
  total: number,
  index: number,
  deltaPx: number,
): number[] {
  const count = sizes.length;
  if (index < 0 || index >= count - 1 || deltaPx === 0) {
    return sizes;
  }
  const px = measure(sizes, minima, total);
  const mins = minima.map((m) => (Number.isFinite(m) && m > 0 ? m : 0));

  // The pane that grows, and the panes that give, in the order they are asked.
  const grows = deltaPx > 0 ? index : index + 1;
  const gives =
    deltaPx > 0
      ? Array.from({ length: count - index - 1 }, (_, k) => index + 1 + k)
      : Array.from({ length: index + 1 }, (_, k) => index - k);

  let wanted = Math.abs(deltaPx);
  for (const i of gives) {
    if (wanted <= 0) {
      break;
    }
    const spare = Math.max(0, px[i] - mins[i]);
    const taken = Math.min(spare, wanted);
    px[i] -= taken;
    px[grows] += taken;
    wanted -= taken;
  }
  return toWeights(px, count);
}

/**
 * Repair a tree.
 *
 * - A pane with no tabs goes away.
 * - A split keeps only the children that survive, in their old proportion.
 * - A split with one child left is replaced by that child.
 * - A split inside a split that runs the same way is pulled up into it.
 * - A tab that appears twice is kept only where it appears first.
 * - An active tab out of range is pulled back into range.
 *
 * This is the repair Lumino does on restore, and toolbox needs it for the same
 * reason: a pane can lose its last tab at any time, and the tree must stay
 * legal without the caller thinking about it.
 *
 * Returns null when nothing is left.
 */
export function normalize(node: LayoutNode | null, seen = new Set<string>()): LayoutNode | null {
  if (node === null) {
    return null;
  }
  if (node.type === "leaf") {
    const tabs: string[] = [];
    for (const tab of node.tabs) {
      if (!seen.has(tab)) {
        seen.add(tab);
        tabs.push(tab);
      }
    }
    if (tabs.length === 0) {
      return null;
    }
    return {
      type: "leaf",
      tabs,
      activeTab: Math.min(Math.max(0, node.activeTab), tabs.length - 1),
    };
  }

  const weights = toWeights(node.sizes, node.children.length);
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  for (const [i, child] of node.children.entries()) {
    const kept = normalize(child, seen);
    if (kept === null) {
      continue;
    }
    if (kept.type === "split" && kept.direction === node.direction) {
      // Same direction: the child's children belong to this split, each holding
      // its old share of the share the child had.
      for (const [k, grandchild] of kept.children.entries()) {
        children.push(grandchild);
        sizes.push(weights[i] * kept.sizes[k]);
      }
      continue;
    }
    children.push(kept);
    sizes.push(weights[i]);
  }
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0];
  }
  return {
    type: "split",
    direction: node.direction,
    children,
    sizes: toWeights(sizes, children.length),
  };
}

/** The path of the pane that holds this tab, or null when no pane holds it. */
export function pathOfTab(root: LayoutNode, tab: string): LayoutPath | null {
  if (root.type === "leaf") {
    return root.tabs.includes(tab) ? [] : null;
  }
  for (const [i, child] of root.children.entries()) {
    const inner = pathOfTab(child, tab);
    if (inner !== null) {
      return [i, ...inner];
    }
  }
  return null;
}

/** The node at this path, or null when the path names nothing. */
export function nodeAt(root: LayoutNode, path: LayoutPath): LayoutNode | null {
  let node: LayoutNode = root;
  for (const step of path) {
    if (node.type !== "split") {
      return null;
    }
    const child = node.children[step];
    if (child === undefined) {
      return null;
    }
    node = child;
  }
  return node;
}

/**
 * Put `next` at `path`, and give back a new tree. The nodes that are not on the
 * path are shared with the old tree, not copied.
 */
export function replaceAt(root: LayoutNode, path: LayoutPath, next: LayoutNode): LayoutNode {
  if (path.length === 0) {
    return next;
  }
  if (root.type !== "split") {
    return root;
  }
  const [step, ...rest] = path;
  const children = [...root.children];
  children[step] = replaceAt(children[step], rest, next);
  return { ...root, children };
}

/** Take a tab out of the tree, then repair what is left. */
export function removeTab(root: LayoutNode, tab: string): LayoutNode | null {
  const path = pathOfTab(root, tab);
  if (path === null) {
    return root;
  }
  const pane = nodeAt(root, path) as LayoutLeaf;
  const at = pane.tabs.indexOf(tab);
  const tabs = pane.tabs.filter((t) => t !== tab);
  // Keep the same tab in front: an earlier tab going away shifts its index down.
  const activeTab = at < pane.activeTab ? pane.activeTab - 1 : pane.activeTab;
  return normalize(replaceAt(root, path, { type: "leaf", tabs, activeTab }));
}

/**
 * Put `tab` into the pane that holds `targetTab`, in front, and repair the tree.
 *
 * A tab that is somewhere else already **moves**; it is not copied. A tab may
 * be in the tree only once, and `normalize` keeps the first copy it finds — so
 * a copy would leave the tab where it started and quietly drop the new one.
 * The pane it came from collapses if it held nothing else.
 *
 * The destination is named by a tab it holds, not by a path. Taking the tab out
 * can collapse a split, and a path taken before that can then point at the
 * wrong pane; a tab id survives the repair.
 *
 * Does nothing when the tab is in that pane already, or when no pane holds
 * `targetTab`.
 */
export function putTab(root: LayoutNode, targetTab: string, tab: string): LayoutNode {
  if (tab === targetTab) {
    return root;
  }
  const home = pathOfTab(root, targetTab);
  if (home === null) {
    return root;
  }
  const from = pathOfTab(root, tab);
  if (from !== null && from.join(",") === home.join(",")) {
    return root;
  }
  const pruned = from === null ? root : removeTab(root, tab);
  if (pruned === null) {
    return root;
  }
  const path = pathOfTab(pruned, targetTab);
  if (path === null) {
    return root;
  }
  const pane = nodeAt(pruned, path) as LayoutLeaf;
  const tabs = [...pane.tabs, tab];
  const next: LayoutLeaf = { type: "leaf", tabs, activeTab: tabs.length - 1 };
  return normalize(replaceAt(pruned, path, next)) ?? root;
}

/**
 * Split the pane at `path` and put `next` beside it.
 *
 * When the pane's parent already runs the same way, `next` joins that parent as
 * a sibling instead of starting a nested split, and takes half of the old
 * pane's share. A row inside a row is only a wider row, so building it flat
 * from the start keeps the divider count honest.
 *
 * Does nothing when `path` names no node.
 */
export function splitPane(
  root: LayoutNode,
  path: LayoutPath,
  direction: SplitDirection,
  next: LayoutNode,
  position: SplitPosition,
): LayoutNode {
  const target = nodeAt(root, path);
  if (target === null) {
    return root;
  }
  const parent = path.length === 0 ? null : (nodeAt(root, path.slice(0, -1)) as LayoutSplit);
  if (parent !== null && parent.direction === direction) {
    const at = path.at(-1)!;
    const children = [...parent.children];
    const sizes = [...parent.sizes];
    const half = sizes[at] / 2;
    const insertAt = position === "after" ? at + 1 : at;
    children.splice(insertAt, 0, next);
    sizes.splice(at, 1, half, half);
    const merged: LayoutSplit = { ...parent, children, sizes: toWeights(sizes, children.length) };
    return normalize(replaceAt(root, path.slice(0, -1), merged)) ?? root;
  }
  const pair = position === "after" ? [target, next] : [next, target];
  return normalize(replaceAt(root, path, split(direction, pair))) ?? root;
}

/**
 * The smallest a pane may become on a drag. A pane narrower than this has no
 * room for its tab bar, and a pane shorter than this has no room for content.
 */
export const MIN_PANE_WIDTH = 160;
export const MIN_PANE_HEIGHT = 80;

/**
 * The smallest this node may become along one axis.
 *
 * A split that runs along the axis needs the sum of its children, because they
 * stand in a line. A split that runs across it needs only its largest child,
 * because they stand on top of each other. Without this, a divider could squash
 * a whole nested tree into the space of one pane.
 */
export function minSize(node: LayoutNode, direction: SplitDirection): number {
  if (node.type === "leaf") {
    return direction === "row" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT;
  }
  const kids = node.children.map((child) => minSize(child, direction));
  return node.direction === direction ? sum(kids) : Math.max(...kids);
}

/**
 * How far a key moves a divider, or null when the key is not ours.
 *
 * Only the two keys along the divider's own axis count. The other two must stay
 * with the page, or the user cannot scroll away from a divider that has focus.
 * Home and End send the divider as far as it goes; `dragDivider` stops it at
 * the minimum of the pane it eats into.
 */
export function keyDelta(key: string, direction: SplitDirection, step: number): number | null {
  const back = direction === "row" ? "ArrowLeft" : "ArrowUp";
  const forward = direction === "row" ? "ArrowRight" : "ArrowDown";
  switch (key) {
    case back: {
      return -step;
    }
    case forward: {
      return step;
    }
    case "Home": {
      return -Number.POSITIVE_INFINITY;
    }
    case "End": {
      return Number.POSITIVE_INFINITY;
    }
    default: {
      return null;
    }
  }
}
