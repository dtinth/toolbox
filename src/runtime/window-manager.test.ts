import { describe, expect, it } from "vite-plus/test";
import {
  createWindowManager,
  instancePrefix,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  scopeId,
  TITLE_BAR_HEIGHT,
} from "./window-manager.ts";

describe("window-manager", () => {
  describe("scopeId / instancePrefix helpers", () => {
    it("scopeId encodes instanceId and originalId with '::'", () => {
      expect(scopeId("inst-1", "__main__")).toBe("inst-1::__main__");
      expect(scopeId("inst-2", "sub1")).toBe("inst-2::sub1");
    });

    it("instancePrefix returns the prefix used to scope all windows for an instance", () => {
      expect(instancePrefix("inst-1")).toBe("inst-1::");
      expect(instancePrefix("inst-42")).toBe("inst-42::");
    });
  });

  describe("place", () => {
    it("places the first window (index 0) centered with offset=0 and zIndex=0", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      const state = wm.slots.get("win-a")!;
      const cx = 800 / 2 - 150; // 250
      const cy = 600 / 2 - 100; // 200
      expect(state.x).toBe(cx);
      expect(state.y).toBe(cy);
      expect(state.zIndex).toBe(0);
    });

    it("steps each further window 30px down-right so none lands on another", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b", "win-c"]);
      const cx = 800 / 2 - 150;
      const cy = 600 / 2 - 100;
      const a = wm.slots.get("win-a")!;
      const b = wm.slots.get("win-b")!;
      const c = wm.slots.get("win-c")!;
      expect([a.x, a.y]).toStrictEqual([cx, cy]);
      expect([b.x, b.y]).toStrictEqual([cx + 30, cy + 30]);
      expect([c.x, c.y]).toStrictEqual([cx + 60, cy + 60]);
      expect(b.zIndex).toBeGreaterThan(a.zIndex);
    });

    it("cascades from the seats already taken, not from position in the call", () => {
      // Per-instance rendering places one instance's windows at a time, so the
      // index within a call says nothing about how many windows already exist.
      // Two tools each placing their first window must not both land on centre.
      const wm = createWindowManager();
      wm.place(["inst-1::__main__"], "inst-1::");
      wm.place(["inst-2::__main__"], "inst-2::");
      const first = wm.slots.get("inst-1::__main__")!;
      const second = wm.slots.get("inst-2::__main__")!;
      expect([second.x, second.y]).toStrictEqual([first.x + 30, first.y + 30]);
      expect(second.zIndex).toBeGreaterThan(first.zIndex);
    });

    it("cascades z-order with each additional window higher than the previous", () => {
      const wm = createWindowManager();
      wm.place(["a", "b", "c"]);
      const za = wm.slots.get("a")!.zIndex;
      const zb = wm.slots.get("b")!.zIndex;
      const zc = wm.slots.get("c")!.zIndex;
      expect(za).toBe(0);
      expect(zb).toBeLessThan(zc);
    });

    it("does not re-place a window that already has state", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      const original = { ...wm.slots.get("win-a")! };
      // Move the window so we can detect if place() overwrites it
      wm.move("win-a", 999, 888);
      wm.place(["win-a"]);
      const after = wm.slots.get("win-a")!;
      expect(after.x).toBe(999);
      expect(after.y).toBe(888);
      // zIndex unchanged too
      expect(after.zIndex).toBe(original.zIndex);
    });

    it("places new windows in a subsequent call, preserving existing ones", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      wm.place(["win-a", "win-b"]);
      // win-a should be unchanged
      expect(wm.slots.get("win-a")!.zIndex).toBe(0);
      // win-b should now exist
      expect(wm.slots.has("win-b")).toBeTruthy();
    });
  });

  describe("cascade bounds", () => {
    // jsdom has no window, so place() falls back to an 800x600 viewport.
    const VW = 800;
    const VH = 600;

    it("never strands a window's title bar off the screen", () => {
      const wm = createWindowManager();
      wm.place(Array.from({ length: 40 }, (_, i) => `win-${i}`));
      for (const slot of wm.slots.values()) {
        // Enough of the title bar must be reachable to grab, and all of its
        // height must be on screen — an unreachable title bar means the window
        // cannot be moved, focused, or closed.
        expect(slot.x + MIN_WINDOW_WIDTH).toBeLessThanOrEqual(VW);
        expect(slot.y + TITLE_BAR_HEIGHT).toBeLessThanOrEqual(VH);
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.y).toBeGreaterThanOrEqual(0);
      }
    });

    it("restarts at centre rather than piling up in the corner", () => {
      const wm = createWindowManager();
      wm.place(Array.from({ length: 40 }, (_, i) => `win-${i}`));
      const first = wm.slots.get("win-0")!;
      const positions = [...wm.slots.values()].map((s) => `${s.x},${s.y}`);
      // A clamp would leave every late window at the same corner; a restart
      // brings one back to exactly where the first window sits.
      expect(positions.filter((p) => p === `${first.x},${first.y}`).length).toBeGreaterThan(1);
      // ...and the step before the restart must not be the corner repeated.
      expect(new Set(positions).size).toBeGreaterThan(5);
    });

    it("still steps normally while there is room", () => {
      const wm = createWindowManager();
      wm.place(["a", "b", "c"]);
      const a = wm.slots.get("a")!;
      const c = wm.slots.get("c")!;
      expect(c.x).toBe(a.x + 60);
      expect(c.y).toBe(a.y + 60);
    });
  });

  describe("presence", () => {
    it("marks every id in the call present", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      expect(wm.slots.get("win-a")!.present).toBeTruthy();
      expect(wm.slots.get("win-b")!.present).toBeTruthy();
    });

    it("makes a known slot dormant when its window is no longer declared", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      wm.place(["win-a"]);
      expect(wm.slots.get("win-b")!.present).toBeFalsy();
    });

    it("keeps a dormant slot's geometry so the window returns where it was", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      wm.move("win-b", 640, 480);
      const z = wm.slots.get("win-b")!.zIndex;
      wm.place(["win-a"]);
      wm.place(["win-a", "win-b"]);
      const b = wm.slots.get("win-b")!;
      expect(b.present).toBeTruthy();
      expect(b.x).toBe(640);
      expect(b.y).toBe(480);
      expect(b.zIndex).toBe(z);
    });

    it("keeps a dormant slot in the map rather than deleting it", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      wm.place(["win-a"]);
      expect(wm.slots.has("win-b")).toBeTruthy();
      expect(wm.slots.size).toBe(2);
    });

    it("only touches slots under the given scope", () => {
      // renderInstance() places one instance's windows at a time, so an
      // unscoped sweep would mark every other instance's windows dormant.
      const wm = createWindowManager();
      wm.place(["inst-1::main", "inst-1::sub", "inst-2::main"]);
      wm.place(["inst-1::main"], "inst-1::");
      expect(wm.slots.get("inst-1::sub")!.present).toBeFalsy();
      expect(wm.slots.get("inst-2::main")!.present).toBeTruthy();
    });

    it("marks an instance's every window dormant when it declares none", () => {
      const wm = createWindowManager();
      wm.place(["inst-1::main", "inst-2::main"]);
      wm.place([], "inst-1::");
      expect(wm.slots.get("inst-1::main")!.present).toBeFalsy();
      expect(wm.slots.get("inst-2::main")!.present).toBeTruthy();
    });
  });

  describe("resize", () => {
    it("starts a slot unsized so the window keeps sizing to its content", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      const slot = wm.slots.get("win-a")!;
      expect(slot.width).toBeNull();
      expect(slot.height).toBeNull();
    });

    it("records a width and height", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      wm.resize("win-a", 640, 480);
      expect(wm.slots.get("win-a")).toMatchObject({ width: 640, height: 480 });
    });

    it("refuses to shrink a window into nothing", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      wm.resize("win-a", 1, 1);
      expect(wm.slots.get("win-a")).toMatchObject({
        width: MIN_WINDOW_WIDTH,
        height: MIN_WINDOW_HEIGHT,
      });
    });

    it("leaves position and z-order alone", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      const { x, y, zIndex } = wm.slots.get("win-a")!;
      wm.resize("win-a", 500, 400);
      expect(wm.slots.get("win-a")).toMatchObject({ x, y, zIndex });
    });

    it("survives going dormant and coming back", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      wm.resize("win-b", 500, 400);
      wm.place(["win-a"]);
      wm.place(["win-a", "win-b"]);
      expect(wm.slots.get("win-b")).toMatchObject({ width: 500, height: 400 });
    });

    it("resize on an unknown id is a no-op", () => {
      const wm = createWindowManager();
      expect(() => {
        wm.resize("unknown", 500, 400);
      }).not.toThrow();
      expect(wm.slots.size).toBe(0);
    });
  });

  describe("focus", () => {
    it("raises a window to have the highest zIndex", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      const zb = wm.slots.get("win-b")!.zIndex;
      // win-a starts lower; focus it
      const changed = wm.focus("win-a");
      expect(changed).toBeTruthy();
      expect(wm.slots.get("win-a")!.zIndex).toBeGreaterThan(zb);
    });

    it("focus on the already-top window leaves zIndex unchanged and returns false", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      const zb = wm.slots.get("win-b")!.zIndex;
      const changed = wm.focus("win-b");
      expect(changed).toBeFalsy();
      expect(wm.slots.get("win-b")!.zIndex).toBe(zb);
    });

    it("focus on a dormant slot is a no-op and returns false", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      wm.place(["win-b"]);
      const z = wm.slots.get("win-a")!.zIndex;
      expect(wm.focus("win-a")).toBeFalsy();
      expect(wm.slots.get("win-a")!.zIndex).toBe(z);
    });

    it("still raises a present slot when a dormant one sits above it", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b", "win-c"]);
      // win-c is on top, then stops being declared.
      wm.place(["win-a", "win-b"]);
      expect(wm.focus("win-a")).toBeTruthy();
      expect(wm.activeId()).toBe("win-a");
    });

    it("treats the top present slot as top, ignoring a dormant one above it", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b", "win-c"]);
      wm.place(["win-a", "win-b"]);
      // win-b is now the highest window anyone can see, so there is nothing to
      // raise — even though dormant win-c still holds a higher zIndex.
      expect(wm.focus("win-b")).toBeFalsy();
    });

    it("focus on an unknown id is a no-op and returns false", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      let changed: boolean | undefined;
      expect(() => {
        changed = wm.focus("unknown");
      }).not.toThrow();
      expect(changed).toBeFalsy();
      expect(wm.slots.size).toBe(1);
    });
  });

  describe("activeId", () => {
    it("returns null when there are no windows", () => {
      const wm = createWindowManager();
      expect(wm.activeId()).toBeNull();
    });

    it("returns the id of the window with the highest zIndex", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b", "win-c"]);
      // win-c placed last, should have highest z
      expect(wm.activeId()).toBe("win-c");
    });

    it("returns the raised window after focus()", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      wm.focus("win-a");
      expect(wm.activeId()).toBe("win-a");
    });

    it("skips dormant slots, so focus never lands on an undrawn window", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      expect(wm.activeId()).toBe("win-b");
      wm.place(["win-a"]);
      expect(wm.activeId()).toBe("win-a");
    });

    it("returns null when every slot is dormant", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      wm.place([]);
      expect(wm.activeId()).toBeNull();
    });

    it("returns the single window when only one exists", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      expect(wm.activeId()).toBe("win-a");
    });
  });

  describe("move", () => {
    it("updates x and y of a known window", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      wm.move("win-a", 123, 456);
      expect(wm.slots.get("win-a")!.x).toBe(123);
      expect(wm.slots.get("win-a")!.y).toBe(456);
    });

    it("move on an unknown id is a no-op", () => {
      const wm = createWindowManager();
      expect(() => {
        wm.move("unknown", 1, 2);
      }).not.toThrow();
    });

    it("does not change zIndex when moving", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      const zBefore = wm.slots.get("win-a")!.zIndex;
      wm.move("win-a", 50, 50);
      expect(wm.slots.get("win-a")!.zIndex).toBe(zBefore);
    });
  });

  describe("forget", () => {
    it("removes all windows whose id starts with the given prefix", () => {
      const wm = createWindowManager();
      wm.place(["inst-1::main", "inst-1::sub", "inst-2::main"]);
      wm.forget("inst-1::");
      expect(wm.slots.has("inst-1::main")).toBeFalsy();
      expect(wm.slots.has("inst-1::sub")).toBeFalsy();
      expect(wm.slots.has("inst-2::main")).toBeTruthy();
    });

    it("forget with a prefix that matches nothing is a no-op", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      wm.forget("does-not-match::");
      expect(wm.slots.size).toBe(1);
    });
  });

  describe("reset", () => {
    it("clears all slots", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      wm.reset();
      expect(wm.slots.size).toBe(0);
    });

    it("resets the z counter so the next placed window starts from zIndex 0", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      // win-b gets zCounter=1; focus win-a to bump counter further
      wm.focus("win-a");
      wm.reset();
      wm.place(["new-a"]);
      expect(wm.slots.get("new-a")!.zIndex).toBe(0);
    });
  });

  describe("states", () => {
    it("states is a ReadonlyMap that reflects current placements", () => {
      const wm = createWindowManager();
      expect(wm.slots.size).toBe(0);
      wm.place(["win-a"]);
      expect(wm.slots.size).toBe(1);
      expect(wm.slots.get("win-a")).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
        zIndex: 0,
      });
    });
  });

  describe("docking", () => {
    it("starts with nothing docked", () => {
      const wm = createWindowManager();
      expect(wm.layout).toBeNull();
    });

    it("docks a window into the Layout tree", () => {
      const wm = createWindowManager();
      wm.place(["a", "b"]);
      wm.dock("a", { kind: "edge", side: "left" });
      wm.dock("b", { kind: "split", pane: "a", side: "right" });
      expect(wm.isDocked("a")).toBeTruthy();
      expect(wm.isDocked("b")).toBeTruthy();
      expect(wm.layout).toMatchObject({ type: "split", direction: "row" });
    });

    it("keeps the floating geometry of a docked window, so undocking can put it back", () => {
      const wm = createWindowManager();
      wm.place(["a"]);
      wm.move("a", 40, 60);
      wm.resize("a", 300, 200);
      wm.dock("a", { kind: "edge", side: "left" });
      wm.undock("a");
      expect(wm.isDocked("a")).toBeFalsy();
      expect(wm.slots.get("a")).toMatchObject({ x: 40, y: 60, width: 300, height: 200 });
    });

    it("undocks to a given spot, for a window dragged out by its tab", () => {
      const wm = createWindowManager();
      wm.place(["a"]);
      wm.dock("a", { kind: "edge", side: "left" });
      wm.undock("a", { x: 500, y: 300 });
      expect(wm.slots.get("a")).toMatchObject({ x: 500, y: 300 });
    });

    it("raises an undocked window, so it does not land under the others", () => {
      const wm = createWindowManager();
      wm.place(["a", "b"]);
      wm.dock("a", { kind: "edge", side: "left" });
      wm.undock("a");
      expect(wm.activeId()).toBe("a");
    });

    it("cascades a new window past the floating windows only", () => {
      // A docked window takes its place from the tree, so it holds no seat in
      // the cascade.
      const wm = createWindowManager();
      wm.place(["a"]);
      wm.dock("a", { kind: "edge", side: "left" });
      wm.place(["b"]);
      expect(wm.slots.get("b")).toMatchObject({ x: 800 / 2 - 150, y: 600 / 2 - 100 });
    });

    it("keeps a dormant window docked, so it comes back as the same tab", () => {
      const wm = createWindowManager();
      wm.place(["a", "b"]);
      wm.dock("a", { kind: "edge", side: "left" });
      wm.dock("b", { kind: "tab", pane: "a" });
      wm.place(["a"]);
      expect(wm.isDocked("b")).toBeTruthy();
    });

    it("takes a closed tool's windows out of the tree", () => {
      const wm = createWindowManager();
      wm.place(["i1::a", "i2::b"]);
      wm.dock("i1::a", { kind: "edge", side: "left" });
      wm.dock("i2::b", { kind: "split", pane: "i1::a", side: "right" });
      wm.forget("i1::");
      expect(wm.isDocked("i1::a")).toBeFalsy();
      expect(wm.layout).toMatchObject({ type: "leaf", tabs: ["i2::b"] });
    });

    it("empties the tree on reset", () => {
      const wm = createWindowManager();
      wm.place(["a"]);
      wm.dock("a", { kind: "edge", side: "left" });
      wm.reset();
      expect(wm.layout).toBeNull();
    });

    it("takes a new tree whole, for a divider drag or a tab switch", () => {
      const wm = createWindowManager();
      wm.place(["a", "b"]);
      wm.dock("a", { kind: "edge", side: "left" });
      wm.dock("b", { kind: "tab", pane: "a" });
      wm.setLayout({ type: "leaf", tabs: ["a", "b"], activeTab: 0 });
      expect(wm.layout).toMatchObject({ activeTab: 0 });
    });

    it("brings a docked window's tab to the front when it is focused", () => {
      const wm = createWindowManager();
      wm.place(["a", "b"]);
      wm.dock("a", { kind: "edge", side: "left" });
      wm.dock("b", { kind: "tab", pane: "a" });
      wm.focus("a");
      expect(wm.layout).toMatchObject({ tabs: ["a", "b"], activeTab: 0 });
    });
  });
});

describe("pop-out flag", () => {
  it("marks a Slot popped out without moving it, and never stores the flag", () => {
    const wm = createWindowManager();
    wm.place(["a"]);
    const before = { ...wm.slots.get("a") };
    wm.setPoppedOut("a", true);
    expect(wm.slots.get("a")).toStrictEqual({ ...before, poppedOut: true });
    expect(wm.arrangement().slots.a).not.toHaveProperty("poppedOut");
    wm.setPoppedOut("a", false);
    expect(wm.slots.get("a")?.poppedOut).toBeFalsy();
  });
});
