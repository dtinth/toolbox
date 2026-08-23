import { describe, expect, it } from "vite-plus/test";
import {
  dragDivider,
  keyDelta,
  leaf,
  measure,
  MIN_PANE_HEIGHT,
  MIN_PANE_WIDTH,
  minSize,
  nodeAt,
  normalize,
  pathOfTab,
  putTab,
  removeTab,
  split,
  splitPane,
  type LayoutNode,
} from "./layout-tree.ts";

/** Round-trip helper: pixel sizes are floats, and exact equality is noise. */
const round = (values: number[]): number[] => values.map((v) => Math.round(v));

describe("layout-tree", () => {
  describe("constructors", () => {
    it("leaf holds its tabs and shows the first one", () => {
      const node = leaf(["a", "b"]);
      expect(node.type).toBe("leaf");
      expect(node.tabs).toStrictEqual(["a", "b"]);
      expect(node.activeTab).toBe(0);
    });

    it("split without explicit sizes gives every child an equal share", () => {
      const node = split("row", [leaf(["a"]), leaf(["b"]), leaf(["c"])]);
      expect(node.sizes).toStrictEqual([1 / 3, 1 / 3, 1 / 3]);
    });

    it("split normalises the sizes it is given, so only the ratio matters", () => {
      const node = split("row", [leaf(["a"]), leaf(["b"])], [30, 10]);
      expect(node.sizes).toStrictEqual([0.75, 0.25]);
    });
  });

  describe("measure", () => {
    it("divides the space by the ratios when every pane clears its minimum", () => {
      expect(round(measure([0.25, 0.75], [200, 200], 1000))).toStrictEqual([250, 750]);
    });

    it("never returns pixels, so the same tree fits any viewport", () => {
      const sizes = [0.5, 0.5];
      expect(round(measure(sizes, [100, 100], 400))).toStrictEqual([200, 200]);
      expect(round(measure(sizes, [100, 100], 1000))).toStrictEqual([500, 500]);
    });

    it("lifts a pane that falls under its minimum, and takes the room from the rest", () => {
      // 5% of 1000 is 50, under the 200 minimum. The pane gets 200, and the
      // other one gets what is left.
      expect(round(measure([0.05, 0.95], [200, 200], 1000))).toStrictEqual([200, 800]);
    });

    it("lifts two panes at once without giving the room away twice", () => {
      expect(round(measure([0.02, 0.03, 0.95], [200, 200, 200], 1000))).toStrictEqual([
        200, 200, 600,
      ]);
    });

    it("shrinks every pane by the same ratio when the minimums cannot all fit", () => {
      // Three panes want 200 each, but only 300 pixels exist. Nothing can honour
      // the minimum, so each pane keeps its share of what there is.
      expect(round(measure([1, 1, 1], [200, 200, 200], 300))).toStrictEqual([100, 100, 100]);
    });

    it("keeps a hungrier pane larger when the minimums cannot all fit", () => {
      expect(round(measure([1, 1], [300, 100], 200))).toStrictEqual([150, 50]);
    });

    it("treats missing or absurd weights as an equal share", () => {
      expect(round(measure([0, 0], [0, 0], 500))).toStrictEqual([250, 250]);
      expect(round(measure([Number.NaN, 1], [0, 0], 500))).toStrictEqual([250, 250]);
    });
  });

  describe("dragDivider", () => {
    it("moves space from the pane after the divider to the pane before it", () => {
      const sizes = dragDivider([0.5, 0.5], [100, 100], 1000, 0, 100);
      expect(round(measure(sizes, [100, 100], 1000))).toStrictEqual([600, 400]);
    });

    it("moves space the other way when the divider goes back", () => {
      const sizes = dragDivider([0.5, 0.5], [100, 100], 1000, 0, -100);
      expect(round(measure(sizes, [100, 100], 1000))).toStrictEqual([400, 600]);
    });

    it("stops at the minimum of the pane it eats into", () => {
      const sizes = dragDivider([0.5, 0.5], [100, 400], 1000, 0, 500);
      expect(round(measure(sizes, [100, 400], 1000))).toStrictEqual([600, 400]);
    });

    it("stops at the minimum of the pane that grows too, when the drag goes back", () => {
      const sizes = dragDivider([0.5, 0.5], [400, 100], 1000, 0, -500);
      expect(round(measure(sizes, [400, 100], 1000))).toStrictEqual([400, 600]);
    });

    it("takes from the next pane but one when the neighbour is already at its minimum", () => {
      // Drag right by 300. The middle pane can only give 100 before it hits 200,
      // so the last pane gives the other 200.
      const sizes = dragDivider([0.2, 0.3, 0.5], [200, 200, 200], 1000, 0, 300);
      expect(round(measure(sizes, [200, 200, 200], 1000))).toStrictEqual([500, 200, 300]);
    });

    it("leaves the panes on the far side of the divider alone", () => {
      const before = [0.25, 0.25, 0.5];
      const after = dragDivider(before, [100, 100, 100], 1000, 0, 100);
      const px = measure(after, [100, 100, 100], 1000);
      expect(round([px[2]])).toStrictEqual([500]);
    });

    it("returns weights that add up to one, whatever went in", () => {
      const sizes = dragDivider([3, 1], [100, 100], 1000, 0, 50);
      const total = sizes.reduce((a, b) => a + b, 0);
      expect(Math.abs(total - 1)).toBeLessThan(1e-9);
    });

    it("ignores a divider index that names no divider", () => {
      expect(dragDivider([0.5, 0.5], [100, 100], 1000, 1, 100)).toStrictEqual([0.5, 0.5]);
      expect(dragDivider([0.5, 0.5], [100, 100], 1000, -1, 100)).toStrictEqual([0.5, 0.5]);
    });
  });

  describe("normalize", () => {
    it("drops a leaf with no tabs left", () => {
      expect(normalize(leaf([]))).toBeNull();
    });

    it("pulls the only surviving child up in place of its split", () => {
      const tree = split("row", [leaf([]), leaf(["b"])]);
      expect(normalize(tree)).toStrictEqual(leaf(["b"]));
    });

    it("returns null when a split loses every child", () => {
      expect(normalize(split("row", [leaf([]), leaf([])]))).toBeNull();
    });

    it("keeps the sizes of the children that survive, in proportion", () => {
      const tree = split("row", [leaf(["a"]), leaf([]), leaf(["c"])], [1, 1, 2]);
      const out = normalize(tree) as Extract<LayoutNode, { type: "split" }>;
      expect(out.children).toHaveLength(2);
      expect(round(out.sizes.map((s) => s * 100))).toStrictEqual([33, 67]);
    });

    it("hoists a nested split that runs the same way as its parent", () => {
      const inner = split("row", [leaf(["b"]), leaf(["c"])], [1, 1]);
      const tree = split("row", [leaf(["a"]), inner], [1, 1]);
      const out = normalize(tree) as Extract<LayoutNode, { type: "split" }>;
      expect(out.children.map((c) => (c as { tabs: string[] }).tabs)).toStrictEqual([
        ["a"],
        ["b"],
        ["c"],
      ]);
      expect(round(out.sizes.map((s) => s * 100))).toStrictEqual([50, 25, 25]);
    });

    it("leaves a nested split that runs the other way alone", () => {
      const inner = split("column", [leaf(["b"]), leaf(["c"])]);
      const tree = split("row", [leaf(["a"]), inner]);
      const out = normalize(tree) as Extract<LayoutNode, { type: "split" }>;
      expect(out.children).toHaveLength(2);
      expect(out.children[1].type).toBe("split");
    });

    it("keeps only the first copy of a tab that appears twice", () => {
      const tree = split("row", [leaf(["a", "b"]), leaf(["b", "c"])]);
      const out = normalize(tree) as Extract<LayoutNode, { type: "split" }>;
      expect((out.children[0] as { tabs: string[] }).tabs).toStrictEqual(["a", "b"]);
      expect((out.children[1] as { tabs: string[] }).tabs).toStrictEqual(["c"]);
    });

    it("pulls the active tab back into range when tabs go away", () => {
      const node = normalize({ type: "leaf", tabs: ["a", "b"], activeTab: 5 }) as {
        activeTab: number;
      };
      expect(node.activeTab).toBe(1);
    });
  });

  describe("finding a tab", () => {
    it("gives the path of the pane that holds a tab", () => {
      const tree = split("row", [leaf(["a"]), split("column", [leaf(["b"]), leaf(["c"])])]);
      expect(pathOfTab(tree, "a")).toStrictEqual([0]);
      expect(pathOfTab(tree, "c")).toStrictEqual([1, 1]);
    });

    it("gives an empty path when the root itself holds the tab", () => {
      expect(pathOfTab(leaf(["a"]), "a")).toStrictEqual([]);
    });

    it("gives null when no pane holds the tab", () => {
      expect(pathOfTab(leaf(["a"]), "z")).toBeNull();
    });

    it("nodeAt walks a path back to its node", () => {
      const tree = split("row", [leaf(["a"]), leaf(["b"])]);
      expect(nodeAt(tree, [1])).toStrictEqual(leaf(["b"]));
      expect(nodeAt(tree, [7])).toBeNull();
    });
  });

  describe("removeTab", () => {
    it("takes a tab out of its stack and leaves the rest", () => {
      const out = removeTab(leaf(["a", "b"]), "a") as { tabs: string[] };
      expect(out.tabs).toStrictEqual(["b"]);
    });

    it("collapses the split when the last tab of a pane goes", () => {
      const tree = split("row", [leaf(["a"]), leaf(["b"])]);
      expect(removeTab(tree, "a")).toStrictEqual(leaf(["b"]));
    });

    it("returns null when the last tab in the tree goes", () => {
      expect(removeTab(leaf(["a"]), "a")).toBeNull();
    });

    it("does nothing to a tree that never held the tab", () => {
      const tree = split("row", [leaf(["a"]), leaf(["b"])]);
      expect(removeTab(tree, "z")).toStrictEqual(tree);
    });

    it("keeps the same tab active when an earlier tab goes", () => {
      const stack = { type: "leaf" as const, tabs: ["a", "b", "c"], activeTab: 2 };
      const out = removeTab(stack, "a") as { tabs: string[]; activeTab: number };
      expect(out.tabs).toStrictEqual(["b", "c"]);
      expect(out.activeTab).toBe(1);
    });
  });

  describe("putTab", () => {
    it("puts a new tab into the pane that holds the named tab, and shows it", () => {
      const tree = split("row", [leaf(["a"]), leaf(["b"])]);
      const out = putTab(tree, "b", "c") as Extract<LayoutNode, { type: "split" }>;
      expect(out.children[1]).toStrictEqual({ type: "leaf", tabs: ["b", "c"], activeTab: 1 });
      expect(out.children[0]).toStrictEqual(leaf(["a"]));
    });

    it("moves a tab that is already somewhere else, instead of copying it", () => {
      const tree = split("row", [leaf(["a", "b"]), leaf(["c"])]);
      const out = putTab(tree, "c", "b") as Extract<LayoutNode, { type: "split" }>;
      expect(out.children[0]).toStrictEqual(leaf(["a"]));
      expect(out.children[1]).toStrictEqual({ type: "leaf", tabs: ["c", "b"], activeTab: 1 });
    });

    it("collapses the pane the tab came from when it held nothing else", () => {
      const tree = split("row", [leaf(["a"]), leaf(["b"])]);
      expect(putTab(tree, "b", "a")).toStrictEqual({
        type: "leaf",
        tabs: ["b", "a"],
        activeTab: 1,
      });
    });

    it("does nothing when the tab is already in that pane", () => {
      const tree = leaf(["a", "b"]);
      expect(putTab(tree, "a", "b")).toStrictEqual(tree);
    });

    it("does nothing when no pane holds the named tab", () => {
      const tree = leaf(["a"]);
      expect(putTab(tree, "zzz", "b")).toStrictEqual(tree);
    });
  });

  describe("splitPane", () => {
    it("puts the new pane after the old one", () => {
      const out = splitPane(leaf(["a"]), [], "row", leaf(["b"]), "after") as Extract<
        LayoutNode,
        { type: "split" }
      >;
      expect(out.type).toBe("split");
      expect(out.direction).toBe("row");
      expect(out.children.map((c) => (c as { tabs: string[] }).tabs)).toStrictEqual([["a"], ["b"]]);
      expect(out.sizes).toStrictEqual([0.5, 0.5]);
    });

    it("puts the new pane before the old one when asked", () => {
      const out = splitPane(leaf(["a"]), [], "column", leaf(["b"]), "before") as Extract<
        LayoutNode,
        { type: "split" }
      >;
      expect(out.children.map((c) => (c as { tabs: string[] }).tabs)).toStrictEqual([["b"], ["a"]]);
    });

    it("splits a pane deep in the tree without touching its siblings", () => {
      const tree = split("row", [leaf(["a"]), leaf(["b"])], [0.25, 0.75]);
      const out = splitPane(tree, [1], "column", leaf(["c"]), "after") as Extract<
        LayoutNode,
        { type: "split" }
      >;
      expect(out.sizes).toStrictEqual([0.25, 0.75]);
      expect(out.children[0]).toStrictEqual(leaf(["a"]));
      const inner = out.children[1] as Extract<LayoutNode, { type: "split" }>;
      expect(inner.direction).toBe("column");
      expect(inner.children.map((c) => (c as { tabs: string[] }).tabs)).toStrictEqual([
        ["b"],
        ["c"],
      ]);
    });

    it("adds a child to the parent instead of nesting, when the parent runs the same way", () => {
      // A row inside a row is the same thing as a wider row. Normalisation would
      // flatten it anyway, so the split must come out flat.
      const tree = split("row", [leaf(["a"]), leaf(["b"])]);
      const out = splitPane(tree, [0], "row", leaf(["c"]), "after") as Extract<
        LayoutNode,
        { type: "split" }
      >;
      expect(out.children).toHaveLength(3);
      expect(out.children.map((c) => (c as { tabs: string[] }).tabs)).toStrictEqual([
        ["a"],
        ["c"],
        ["b"],
      ]);
    });

    it("does nothing when the path names no pane", () => {
      const tree = leaf(["a"]);
      expect(splitPane(tree, [3], "row", leaf(["b"]), "after")).toStrictEqual(tree);
    });
  });
});

describe("layout-tree sizing helpers", () => {
  describe("minSize", () => {
    it("gives a pane the floor for the way it is measured", () => {
      expect(minSize(leaf(["a"]), "row")).toBe(MIN_PANE_WIDTH);
      expect(minSize(leaf(["a"]), "column")).toBe(MIN_PANE_HEIGHT);
    });

    it("adds up the children of a split that runs the way it is measured", () => {
      const tree = split("row", [leaf(["a"]), leaf(["b"])]);
      expect(minSize(tree, "row")).toBe(MIN_PANE_WIDTH * 2);
    });

    it("takes the largest child of a split that runs the other way", () => {
      // Two panes stacked in a column are as wide as one pane, not two.
      const tree = split("column", [leaf(["a"]), leaf(["b"])]);
      expect(minSize(tree, "row")).toBe(MIN_PANE_WIDTH);
    });

    it("goes down through a deep tree", () => {
      const inner = split("row", [leaf(["b"]), leaf(["c"])]);
      const tree = split("column", [leaf(["a"]), inner]);
      expect(minSize(tree, "row")).toBe(MIN_PANE_WIDTH * 2);
      expect(minSize(tree, "column")).toBe(MIN_PANE_HEIGHT * 2);
    });
  });

  describe("keyDelta", () => {
    it("moves a divider in a row with the left and right keys", () => {
      expect(keyDelta("ArrowRight", "row", 16)).toBe(16);
      expect(keyDelta("ArrowLeft", "row", 16)).toBe(-16);
    });

    it("moves a divider in a column with the up and down keys", () => {
      expect(keyDelta("ArrowDown", "column", 16)).toBe(16);
      expect(keyDelta("ArrowUp", "column", 16)).toBe(-16);
    });

    it("ignores the keys for the other axis, so the page can still scroll", () => {
      expect(keyDelta("ArrowUp", "row", 16)).toBeNull();
      expect(keyDelta("ArrowLeft", "column", 16)).toBeNull();
      expect(keyDelta("Enter", "row", 16)).toBeNull();
    });

    it("sends the divider as far as it goes with Home and End", () => {
      expect(keyDelta("Home", "row", 16)).toBe(-Number.POSITIVE_INFINITY);
      expect(keyDelta("End", "column", 16)).toBe(Number.POSITIVE_INFINITY);
    });

    it("a drag as far as it goes stops at the minimum, and does not overshoot", () => {
      const sizes = dragDivider([0.5, 0.5], [200, 200], 1000, 0, keyDelta("End", "row", 16)!);
      expect(round(measure(sizes, [200, 200], 1000))).toStrictEqual([800, 200]);
    });
  });
});
