import { describe, expect, it } from "vite-plus/test";
import {
  compassAt,
  dock,
  type DockTarget,
  paneRects,
  previewRect,
  COMPASS_BUTTON,
  EDGE_NEAR,
} from "./docking.ts";
import { leaf, type LayoutNode, split } from "./layout-tree.ts";

const AREA = { x: 0, y: 0, w: 1000, h: 600 };
const two = (): LayoutNode => split("row", [leaf(["a"]), leaf(["b", "c"])], [0.5, 0.5]);

describe("paneRects", () => {
  it("gives nothing for an empty tree", () => {
    expect(paneRects(null, AREA)).toStrictEqual([]);
  });

  it("gives a lone pane the whole area", () => {
    expect(paneRects(leaf(["a"]), AREA)).toStrictEqual([{ tabs: ["a"], activeTab: 0, rect: AREA }]);
  });

  it("lays a row out left to right by its weights", () => {
    const rects = paneRects(split("row", [leaf(["a"]), leaf(["b"])], [0.3, 0.7]), AREA);
    expect(rects.map((p) => p.rect)).toStrictEqual([
      { x: 0, y: 0, w: 300, h: 600 },
      { x: 300, y: 0, w: 700, h: 600 },
    ]);
  });

  it("offsets a nested column by the box its parent gave it", () => {
    const tree = split("row", [leaf(["a"]), split("column", [leaf(["b"]), leaf(["c"])])]);
    const rects = paneRects(tree, { x: 10, y: 20, w: 1000, h: 600 });
    expect(rects.map((p) => p.rect)).toStrictEqual([
      { x: 10, y: 20, w: 500, h: 600 },
      { x: 510, y: 20, w: 500, h: 300 },
      { x: 510, y: 320, w: 500, h: 300 },
    ]);
  });
});

describe("dock", () => {
  it("starts a tree when nothing is docked", () => {
    expect(dock(null, "a", { kind: "edge", side: "left" })).toStrictEqual(leaf(["a"]));
  });

  it("adds a tab to the pane that holds the named tab", () => {
    const out = dock(two(), "x", { kind: "tab", pane: "a" });
    expect(paneRects(out, AREA).map((p) => p.tabs)).toStrictEqual([
      ["a", "x"],
      ["b", "c"],
    ]);
  });

  it("splits beside the pane that holds the named tab", () => {
    const out = dock(two(), "x", { kind: "split", pane: "b", side: "top" });
    expect(paneRects(out, AREA).map((p) => p.tabs)).toStrictEqual([["a"], ["x"], ["b", "c"]]);
  });

  it("puts a pane along a whole edge of the layout", () => {
    const out = dock(two(), "x", { kind: "edge", side: "bottom" });
    const rects = paneRects(out, AREA);
    expect(rects.at(-1)).toStrictEqual({
      tabs: ["x"],
      activeTab: 0,
      rect: { x: 0, y: 300, w: 1000, h: 300 },
    });
  });

  it("moves a tab that is docked already, rather than copying it", () => {
    const out = dock(two(), "c", { kind: "split", pane: "a", side: "left" });
    expect(paneRects(out, AREA).map((p) => p.tabs)).toStrictEqual([["c"], ["a"], ["b"]]);
  });

  it("can move the only tab of a pane next to another pane", () => {
    const out = dock(two(), "a", { kind: "tab", pane: "b" });
    expect(paneRects(out, AREA).map((p) => p.tabs)).toStrictEqual([["b", "c", "a"]]);
  });

  it("leaves the tree alone for a pane that is not there", () => {
    const tree = two();
    expect(dock(tree, "x", { kind: "tab", pane: "nope" })).toStrictEqual(tree);
  });
});

describe("previewRect", () => {
  it("is the rectangle the window would get, from the real arithmetic", () => {
    expect(
      previewRect(two(), "x", { kind: "split", pane: "a", side: "right" }, AREA),
    ).toStrictEqual({ x: 250, y: 0, w: 250, h: 600 });
  });

  it("is the whole pane for a new tab", () => {
    expect(previewRect(two(), "x", { kind: "tab", pane: "b" }, AREA)).toStrictEqual({
      x: 500,
      y: 0,
      w: 500,
      h: 600,
    });
  });
});

const targets = (buttons: { target: DockTarget }[]) => buttons.map((b) => b.target);

describe("compassAt", () => {
  it("shows the five buttons of the pane under the pointer, and no other pane's", () => {
    const shown = compassAt(two(), AREA, "x", 750, 300);
    expect(targets(shown)).toStrictEqual([
      { kind: "tab", pane: "b" },
      { kind: "split", pane: "b", side: "left" },
      { kind: "split", pane: "b", side: "right" },
      { kind: "split", pane: "b", side: "top" },
      { kind: "split", pane: "b", side: "bottom" },
    ]);
  });

  it("centres the buttons on the pane", () => {
    const middle = compassAt(two(), AREA, "x", 750, 300)[0];
    expect(middle.rect).toStrictEqual({
      x: 750 - COMPASS_BUTTON / 2,
      y: 300 - COMPASS_BUTTON / 2,
      w: COMPASS_BUTTON,
      h: COMPASS_BUTTON,
    });
  });

  it("adds an edge button only when the pointer comes near that edge", () => {
    const far = compassAt(two(), AREA, "x", 1000 - EDGE_NEAR - 1, 300);
    expect(targets(far)).not.toContainEqual({ kind: "edge", side: "right" });
    const near = compassAt(two(), AREA, "x", 1000 - EDGE_NEAR + 1, 300);
    expect(targets(near)).toContainEqual({ kind: "edge", side: "right" });
  });

  it("names a pane by a tab other than the one being dragged", () => {
    // Dragging "b" out of its own pane: the pane must still be a target, and
    // naming it by "b" would point at a tab that is about to leave.
    const shown = compassAt(two(), AREA, "b", 750, 300);
    expect(shown[0].target).toStrictEqual({ kind: "tab", pane: "c" });
  });

  it("offers only a way back over the pane a lone tab came from", () => {
    // Over its own pane there is nowhere to go. One button that puts it back
    // is the cancel for a finger, which has no Escape key.
    const shown = compassAt(two(), AREA, "a", 250, 300);
    expect(targets(shown)).toStrictEqual([{ kind: "back" }]);
  });

  it("offers one button in the middle when nothing is docked", () => {
    const shown = compassAt(null, AREA, "x", 100, 100);
    expect(targets(shown)).toStrictEqual([{ kind: "edge", side: "left" }]);
    expect(shown[0].rect.x).toBe(500 - COMPASS_BUTTON / 2);
  });

  it("shows nothing outside the area", () => {
    expect(compassAt(two(), AREA, "x", -5, 300)).toStrictEqual([]);
  });
});
