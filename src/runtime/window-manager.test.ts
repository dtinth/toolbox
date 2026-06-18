import { describe, expect, it } from "vite-plus/test";
import { createWindowManager, instancePrefix, scopeId } from "./window-manager.ts";

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
      const state = wm.states.get("win-a")!;
      const cx = 800 / 2 - 150; // 250
      const cy = 600 / 2 - 100; // 200
      expect(state.x).toBe(cx);
      expect(state.y).toBe(cy);
      expect(state.zIndex).toBe(0);
    });

    it("places the second window (index 1) with offset=(i-1)*30=0 and zIndex > 0", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      const a = wm.states.get("win-a")!;
      const b = wm.states.get("win-b")!;
      const cx = 800 / 2 - 150;
      const cy = 600 / 2 - 100;
      // index=1 → offset = (1-1)*30 = 0
      expect(b.x).toBe(cx);
      expect(b.y).toBe(cy);
      expect(b.zIndex).toBeGreaterThan(a.zIndex);
    });

    it("places the third window (index 2) with offset=(2-1)*30=30", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b", "win-c"]);
      const cx = 800 / 2 - 150;
      const cy = 600 / 2 - 100;
      const c = wm.states.get("win-c")!;
      expect(c.x).toBe(cx + 30);
      expect(c.y).toBe(cy + 30);
    });

    it("cascades z-order with each additional window higher than the previous", () => {
      const wm = createWindowManager();
      wm.place(["a", "b", "c"]);
      const za = wm.states.get("a")!.zIndex;
      const zb = wm.states.get("b")!.zIndex;
      const zc = wm.states.get("c")!.zIndex;
      expect(za).toBe(0);
      expect(zb).toBeLessThan(zc);
    });

    it("does not re-place a window that already has state", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      const original = { ...wm.states.get("win-a")! };
      // Move the window so we can detect if place() overwrites it
      wm.move("win-a", 999, 888);
      wm.place(["win-a"]);
      const after = wm.states.get("win-a")!;
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
      expect(wm.states.get("win-a")!.zIndex).toBe(0);
      // win-b should now exist
      expect(wm.states.has("win-b")).toBe(true);
    });
  });

  describe("focus", () => {
    it("raises a window to have the highest zIndex", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      const zb = wm.states.get("win-b")!.zIndex;
      // win-a starts lower; focus it
      const changed = wm.focus("win-a");
      expect(changed).toBe(true);
      expect(wm.states.get("win-a")!.zIndex).toBeGreaterThan(zb);
    });

    it("focus on the already-top window leaves zIndex unchanged and returns false", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      const zb = wm.states.get("win-b")!.zIndex;
      const changed = wm.focus("win-b");
      expect(changed).toBe(false);
      expect(wm.states.get("win-b")!.zIndex).toBe(zb);
    });

    it("focus on an unknown id is a no-op and returns false", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      let changed: boolean | undefined;
      expect(() => {
        changed = wm.focus("unknown");
      }).not.toThrow();
      expect(changed).toBe(false);
      expect(wm.states.size).toBe(1);
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
      expect(wm.states.get("win-a")!.x).toBe(123);
      expect(wm.states.get("win-a")!.y).toBe(456);
    });

    it("move on an unknown id is a no-op", () => {
      const wm = createWindowManager();
      expect(() => wm.move("unknown", 1, 2)).not.toThrow();
    });

    it("does not change zIndex when moving", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      const zBefore = wm.states.get("win-a")!.zIndex;
      wm.move("win-a", 50, 50);
      expect(wm.states.get("win-a")!.zIndex).toBe(zBefore);
    });
  });

  describe("forget", () => {
    it("removes all windows whose id starts with the given prefix", () => {
      const wm = createWindowManager();
      wm.place(["inst-1::main", "inst-1::sub", "inst-2::main"]);
      wm.forget("inst-1::");
      expect(wm.states.has("inst-1::main")).toBe(false);
      expect(wm.states.has("inst-1::sub")).toBe(false);
      expect(wm.states.has("inst-2::main")).toBe(true);
    });

    it("forget with a prefix that matches nothing is a no-op", () => {
      const wm = createWindowManager();
      wm.place(["win-a"]);
      wm.forget("does-not-match::");
      expect(wm.states.size).toBe(1);
    });
  });

  describe("reset", () => {
    it("clears all window states", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      wm.reset();
      expect(wm.states.size).toBe(0);
    });

    it("resets the z counter so the next placed window starts from zIndex 0", () => {
      const wm = createWindowManager();
      wm.place(["win-a", "win-b"]);
      // win-b gets zCounter=1; focus win-a to bump counter further
      wm.focus("win-a");
      wm.reset();
      wm.place(["new-a"]);
      expect(wm.states.get("new-a")!.zIndex).toBe(0);
    });
  });

  describe("states", () => {
    it("states is a ReadonlyMap that reflects current placements", () => {
      const wm = createWindowManager();
      expect(wm.states.size).toBe(0);
      wm.place(["win-a"]);
      expect(wm.states.size).toBe(1);
      expect(wm.states.get("win-a")).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
        zIndex: 0,
      });
    });
  });
});
