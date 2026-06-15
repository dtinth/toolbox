import { describe, expect, it } from "vite-plus/test";
import { createRuntime } from "./runtime.ts";
import type { Ui } from "./collector.ts";

describe("runtime", () => {
  it("passes an api object with onRender, ui, and requestUpdate", () => {
    const runtime = createRuntime();
    let capturedApi: unknown = null;
    runtime.loadTool((api) => {
      capturedApi = api;
      api.onRender = () => {};
    });
    const api = capturedApi as {
      onRender?: () => void;
      ui: Ui;
      requestUpdate: () => void;
      dispose: () => void;
    };
    expect(api.ui).toBeTypeOf("object");
    expect(api.requestUpdate).toBeTypeOf("function");
    expect(typeof api.ui.window.setTitle).toBe("function");
    expect(typeof api.dispose).toBe("function");
  });

  it("captures a button click handler and runs requestUpdate on click", () => {
    const runtime = createRuntime();
    runtime.loadTool((api) => {
      let count = 0;
      api.onRender = () => {
        api.ui.window.setTitle("Counter");
        api.ui.label(`count=${count}`);
        api.ui.button("+", {
          onClick: () => {
            count++;
            api.requestUpdate();
          },
        });
      };
    });
    runtime.render();
    expect(runtime.updateCount).toBe(0);
    const button = runtime.lastButton();
    button.onClick!();
    expect(runtime.updateCount).toBe(1);
  });

  it("renders a declarator that declares a window with a label", () => {
    const runtime = createRuntime();
    runtime.loadTool((api) => {
      api.onRender = () => {
        api.ui.window.setTitle("Hello");
        api.ui.label("Hi there");
      };
    });
    const vnode = runtime.render();
    expect(vnode).toBeTruthy();
  });

  it("does not throw when requestUpdate is called before any tool is loaded", () => {
    const runtime = createRuntime();
    expect(() => runtime.requestUpdate()).not.toThrow();
  });

  it("api.tick(cb) registers a callback that fires when manually ticked", () => {
    const runtime = createRuntime();
    let ticks = 0;
    runtime.loadTool((api) => {
      api.onRender = () => {};
      api.tick(() => {
        ticks++;
      });
    });
    runtime.tick();
    runtime.tick();
    expect(ticks).toBe(2);
  });

  it("api.tick returns an unsubscribe function", () => {
    const runtime = createRuntime();
    let ticks = 0;
    runtime.loadTool((api) => {
      api.onRender = () => {};
      const unsub = api.tick(() => {
        ticks++;
      });
      unsub();
    });
    runtime.tick();
    expect(ticks).toBe(0);
  });

  it("api.tick triggers a redraw after the callback runs", async () => {
    const runtime = createRuntime();
    let redraws = 0;
    runtime.loadTool((api) => {
      api.onRender = () => {
        redraws++;
      };
      api.tick(() => {});
    });
    runtime.render();
    expect(redraws).toBe(1);
    runtime.tick();
    await new Promise<void>((r) => queueMicrotask(r));
    expect(redraws).toBe(2);
  });

  it("api.toast.show returns a handle with update and dismiss", () => {
    const runtime = createRuntime();
    let handle: unknown = null;
    runtime.loadTool((api) => {
      handle = api.toast.show("Hello", { loading: true });
    });
    const h = handle as { update: (o: object) => void; dismiss: () => void };
    expect(typeof h.update).toBe("function");
    expect(typeof h.dismiss).toBe("function");
    h.dismiss();
  });

  it("toasts are tracked in the runtime and can be enumerated", () => {
    const runtime = createRuntime();
    runtime.loadTool((api) => {
      api.toast.show("one", { loading: true });
      api.toast.show("two");
    });
    const toasts = runtime.toasts();
    expect(toasts).toHaveLength(2);
    expect(toasts[0]!.message).toBe("one");
    expect(toasts[0]!.loading).toBe(true);
    expect(toasts[1]!.message).toBe("two");
    expect(toasts[1]!.loading).toBe(false);
  });

  describe("window states", () => {
    it("focusWindow(id) increases the window's zIndex above all others", () => {
      const runtime = createRuntime();
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.window("sub1", "Sub 1", () => {
            api.ui.label("sub1");
          });
          api.ui.window("sub2", "Sub 2", () => {
            api.ui.label("sub2");
          });
        };
      });
      runtime.render();
      const wm = runtime.windowStates;
      const s1 = wm.get("sub1")!;
      const s2 = wm.get("sub2")!;
      const z1 = s1.zIndex;
      const z2 = s2.zIndex;
      expect(z1).toBeLessThan(z2);
      runtime.focusWindow("sub1");
      expect(wm.get("sub1")!.zIndex).toBeGreaterThan(wm.get("sub2")!.zIndex);
    });

    it("focusWindow(id) on an already-focused window doesn't change zIndex unnecessarily", () => {
      const runtime = createRuntime();
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.window("sub1", "Sub 1", () => {
            api.ui.label("sub1");
          });
        };
      });
      runtime.render();
      const state = runtime.windowStates.get("sub1")!;
      const zBefore = state.zIndex;
      runtime.focusWindow("sub1");
      expect(state.zIndex).toBe(zBefore);
    });

    it("windowStates returns positions for all known windows after render", () => {
      const runtime = createRuntime();
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.window.setTitle("Main");
          api.ui.label("hello");
          api.ui.window("sub1", "Sub", () => {
            api.ui.label("sub");
          });
        };
      });
      runtime.render();
      expect(runtime.windowStates.has("__main__")).toBe(true);
      expect(runtime.windowStates.has("sub1")).toBe(true);
      expect(runtime.windowStates.size).toBe(2);
      const main = runtime.windowStates.get("__main__")!;
      expect(main.x).toBeTypeOf("number");
      expect(main.y).toBeTypeOf("number");
      expect(main.zIndex).toBeTypeOf("number");
    });

    it("Window positions center initially and cascade for sub-windows", () => {
      const runtime = createRuntime();
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.window("sub1", "Sub 1", () => {
            api.ui.label("a");
          });
          api.ui.window("sub2", "Sub 2", () => {
            api.ui.label("b");
          });
        };
      });
      runtime.render();
      const main = runtime.windowStates.get("__main__")!;
      const sub1 = runtime.windowStates.get("sub1")!;
      const sub2 = runtime.windowStates.get("sub2")!;
      const cx = 800 / 2 - 150;
      const cy = 600 / 2 - 100;
      expect(main.x).toBe(cx);
      expect(main.y).toBe(cy);
      expect(sub1.x).toBe(cx);
      expect(sub1.y).toBe(cy);
      expect(sub2.x).toBe(cx + 30);
      expect(sub2.y).toBe(cy + 30);
    });

    it("Loading a new tool resets window states", () => {
      const runtime = createRuntime();
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.label("first");
        };
      });
      runtime.render();
      expect(runtime.windowStates.size).toBeGreaterThan(0);
      runtime.loadTool((api) => {
        api.onRender = () => {};
      });
      expect(runtime.windowStates.size).toBe(0);
    });
  });

  describe("dispose", () => {
    it("api.dispose() marks the runtime as disposed", () => {
      const runtime = createRuntime();
      expect(runtime.disposed).toBe(false);
      runtime.loadTool((api) => {
        api.onRender = () => {};
        api.dispose();
      });
      expect(runtime.disposed).toBe(true);
    });

    it("dispose() triggers a redraw (updateCount increments)", () => {
      const runtime = createRuntime();
      runtime.loadTool((api) => {
        api.onRender = () => {};
      });
      const before = runtime.updateCount;
      runtime.dispose();
      expect(runtime.updateCount).toBeGreaterThan(before);
    });
  });
});
