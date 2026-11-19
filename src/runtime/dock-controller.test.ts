import { describe, expect, it } from "vite-plus/test";
import { createDockController, PANE_TAB_BAR } from "./dock-controller.ts";
import { createTestRuntime } from "./runtime.ts";
import { createWindowManager } from "./window-manager.ts";

// Without a browser, the viewport the Layout fills is 800 by 600.
const W = 800;
const H = 600;

function setup() {
  const wm = createWindowManager();
  let redraws = 0;
  const dock = createDockController(wm, () => {
    redraws++;
  });
  wm.place(["a", "b"]);
  return { wm, dock, redraws: () => redraws };
}

describe("dock controller", () => {
  describe("placeOf", () => {
    it("gives a floating window no place, so it keeps its own", () => {
      const { dock } = setup();
      expect(dock.context.placeOf("a")).toBeNull();
    });

    it("puts a docked window under its Pane's tab bar", () => {
      const { dock } = setup();
      dock.dock("a", { kind: "edge", side: "left" });
      expect(dock.context.placeOf("a")).toStrictEqual({
        rect: { x: 0, y: PANE_TAB_BAR, w: W, h: H - PANE_TAB_BAR },
        shown: true,
      });
    });

    it("hides a window whose tab is behind another", () => {
      const { dock } = setup();
      dock.dock("a", { kind: "edge", side: "left" });
      dock.dock("b", { kind: "tab", pane: "a" });
      expect(dock.context.placeOf("a")?.shown).toBeFalsy();
      expect(dock.context.placeOf("b")?.shown).toBeTruthy();
    });
  });

  describe("a drag", () => {
    it("offers one button in the middle when nothing is docked", () => {
      const { dock } = setup();
      dock.move("a", W / 2, H / 2);
      expect(dock.drag?.buttons).toHaveLength(1);
      expect(dock.drag?.target).toStrictEqual({ kind: "edge", side: "left" });
      expect(dock.drag?.preview).toStrictEqual({ x: 0, y: 0, w: W, h: H });
    });

    it("has no target away from every button, and floats when let go", () => {
      const { dock, wm } = setup();
      dock.move("a", 10, 10);
      expect(dock.drag?.target).toBeNull();
      expect(dock.end(true)).toBeNull();
      expect(wm.layout).toBeNull();
    });

    it("docks the window when let go on a button", () => {
      const { dock, wm, redraws } = setup();
      dock.move("a", W / 2, H / 2);
      expect(dock.end(true)).toStrictEqual({ kind: "edge", side: "left" });
      expect(wm.isDocked("a")).toBeTruthy();
      expect(redraws()).toBe(1);
      expect(dock.drag).toBeNull();
    });

    it("docks nothing when cancelled, even over a button", () => {
      const { dock, wm } = setup();
      dock.move("a", W / 2, H / 2);
      expect(dock.end(false)).toBeNull();
      expect(wm.layout).toBeNull();
    });

    it("tells its subscribers as it moves and when it ends", () => {
      const { dock } = setup();
      let calls = 0;
      const unsubscribe = dock.subscribe(() => {
        calls++;
      });
      dock.move("a", 10, 10);
      dock.end(false);
      unsubscribe();
      dock.move("a", 10, 10);
      expect(calls).toBe(2);
    });
  });
});

describe("runtime docking", () => {
  it("names a tab by the title its window drew last", () => {
    const runtime = createTestRuntime();
    runtime.loadTool((api) => {
      api.onRender = () => {
        api.ui.window.setTitle("Hello");
      };
    });
    runtime.render();
    const id = runtime.windowTree[0].id;
    expect(runtime.windowTitle(id)).toBe("Hello");
    expect(runtime.canCloseWindow(id)).toBeTruthy();
  });

  it("takes a closed tool's windows out of the Layout", () => {
    const runtime = createTestRuntime();
    runtime.loadTool((api) => {
      api.onRender = () => {};
    });
    runtime.render();
    const id = runtime.windowTree[0].id;
    runtime.dockWindow(id, { kind: "edge", side: "left" });
    expect(runtime.layout).not.toBeNull();
    runtime.closeTool(runtime.toolInstances()[0].instanceId);
    expect(runtime.layout).toBeNull();
  });

  it("floats a docked window back out", () => {
    const runtime = createTestRuntime();
    runtime.loadTool((api) => {
      api.onRender = () => {};
    });
    runtime.render();
    const id = runtime.windowTree[0].id;
    runtime.dockWindow(id, { kind: "edge", side: "left" });
    runtime.undockWindow(id);
    expect(runtime.layout).toBeNull();
  });
});
