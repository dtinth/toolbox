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
      const ids = Array.from(wm.keys()).filter((k) => k.endsWith("::sub1") || k.endsWith("::sub2"));
      const id1 = ids.find((k) => k.endsWith("::sub1"))!;
      const id2 = ids.find((k) => k.endsWith("::sub2"))!;
      const s1 = wm.get(id1)!;
      const s2 = wm.get(id2)!;
      const z1 = s1.zIndex;
      const z2 = s2.zIndex;
      expect(z1).toBeLessThan(z2);
      runtime.focusWindow(id1);
      expect(wm.get(id1)!.zIndex).toBeGreaterThan(wm.get(id2)!.zIndex);
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
      const id = Array.from(runtime.windowStates.keys()).find((k) => k.endsWith("::sub1"))!;
      const state = runtime.windowStates.get(id)!;
      const zBefore = state.zIndex;
      runtime.focusWindow(id);
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
      const ids = Array.from(runtime.windowStates.keys());
      expect(ids.some((k) => k.endsWith("::__main__"))).toBe(true);
      expect(ids.some((k) => k.endsWith("::sub1"))).toBe(true);
      expect(runtime.windowStates.size).toBe(2);
      const mainId = ids.find((k) => k.endsWith("::__main__"))!;
      const main = runtime.windowStates.get(mainId)!;
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
      const ids = Array.from(runtime.windowStates.keys());
      const mainId = ids.find((k) => k.endsWith("::__main__"))!;
      const sub1Id = ids.find((k) => k.endsWith("::sub1"))!;
      const sub2Id = ids.find((k) => k.endsWith("::sub2"))!;
      const main = runtime.windowStates.get(mainId)!;
      const sub1 = runtime.windowStates.get(sub1Id)!;
      const sub2 = runtime.windowStates.get(sub2Id)!;
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

  describe("multiple instances", () => {
    it("launchTool returns a ToolInstanceInfo and adds to toolInstances()", () => {
      const runtime = createRuntime();
      const info = runtime.launchTool({
        manifestId: "counter",
        name: "Counter",
        loader: (api) => {
          api.onRender = () => {};
        },
      });
      expect(info.manifestId).toBe("counter");
      expect(info.name).toBe("Counter");
      expect(info.instanceId).toBeTypeOf("string");
      expect(runtime.toolInstances()).toHaveLength(1);
      expect(runtime.toolInstances()[0]).toEqual(info);
    });

    it("isEmpty is true initially and false after launch", () => {
      const runtime = createRuntime();
      expect(runtime.isEmpty).toBe(true);
      runtime.launchTool({
        manifestId: "counter",
        name: "Counter",
        loader: (api) => {
          api.onRender = () => {};
        },
      });
      expect(runtime.isEmpty).toBe(false);
    });

    it("two concurrent instances coexist in render() and windowStates", () => {
      const runtime = createRuntime();
      runtime.launchTool({
        manifestId: "a",
        name: "A",
        loader: (api) => {
          api.onRender = () => {
            api.ui.label("A");
          };
        },
      });
      runtime.launchTool({
        manifestId: "b",
        name: "B",
        loader: (api) => {
          api.onRender = () => {
            api.ui.label("B");
          };
        },
      });
      runtime.render();
      expect(runtime.toolInstances()).toHaveLength(2);
      expect(runtime.windowStates.size).toBe(2);
      const ids = Array.from(runtime.windowStates.keys());
      const hasA = ids.some((k) => k.startsWith("inst-1::"));
      const hasB = ids.some((k) => k.startsWith("inst-2::"));
      expect(hasA).toBe(true);
      expect(hasB).toBe(true);
    });

    it("closeTool removes the instance and its windows; isEmpty flips back to true", () => {
      const runtime = createRuntime();
      const a = runtime.launchTool({
        manifestId: "a",
        name: "A",
        loader: (api) => {
          api.onRender = () => {
            api.ui.label("A");
          };
        },
      });
      const b = runtime.launchTool({
        manifestId: "b",
        name: "B",
        loader: (api) => {
          api.onRender = () => {
            api.ui.label("B");
          };
        },
      });
      runtime.render();
      expect(runtime.isEmpty).toBe(false);
      runtime.closeTool(a.instanceId);
      expect(runtime.toolInstances()).toHaveLength(1);
      expect(runtime.toolInstances()[0]!.instanceId).toBe(b.instanceId);
      expect(Array.from(runtime.windowStates.keys()).some((k) => k.startsWith("inst-1::"))).toBe(
        false,
      );
      runtime.closeTool(b.instanceId);
      expect(runtime.toolInstances()).toHaveLength(0);
      expect(runtime.windowStates.size).toBe(0);
      expect(runtime.isEmpty).toBe(true);
    });

    it("windowStates keys are scoped per instance (inst-N::originalId)", () => {
      const runtime = createRuntime();
      runtime.launchTool({
        manifestId: "a",
        name: "A",
        loader: (api) => {
          api.onRender = () => {
            api.ui.label("A");
          };
        },
      });
      runtime.launchTool({
        manifestId: "b",
        name: "B",
        loader: (api) => {
          api.onRender = () => {
            api.ui.label("B");
          };
        },
      });
      runtime.render();
      const keys = Array.from(runtime.windowStates.keys());
      expect(keys).toContain("inst-1::__main__");
      expect(keys).toContain("inst-2::__main__");
    });

    it("activeWindowId returns the scoped id of the topmost window", () => {
      const runtime = createRuntime();
      runtime.launchTool({
        manifestId: "a",
        name: "A",
        loader: (api) => {
          api.onRender = () => {
            api.ui.label("A");
          };
        },
      });
      runtime.launchTool({
        manifestId: "b",
        name: "B",
        loader: (api) => {
          api.onRender = () => {
            api.ui.label("B");
          };
        },
      });
      runtime.render();
      const active = runtime.activeWindowId;
      expect(active).toBeTruthy();
      expect(active).toMatch(/^inst-\d+::__main__$/);
    });

    it("toasts from two instances aggregate and can be dismissed", () => {
      const runtime = createRuntime();
      let handleA: { dismiss: () => void } | null = null;
      let handleB: { dismiss: () => void } | null = null;
      runtime.launchTool({
        manifestId: "a",
        name: "A",
        loader: (api) => {
          api.onRender = () => {};
          handleA = api.toast.show("from A", { loading: true });
        },
      });
      runtime.launchTool({
        manifestId: "b",
        name: "B",
        loader: (api) => {
          api.onRender = () => {};
          handleB = api.toast.show("from B", { loading: true });
        },
      });
      const toasts = runtime.toasts();
      expect(toasts).toHaveLength(2);
      const messages = toasts.map((t) => t.message).sort();
      expect(messages).toEqual(["from A", "from B"]);
      const ids = toasts.map((t) => t.id);
      expect(new Set(ids).size).toBe(2);
      runtime.dismissToast(ids[0]!);
      expect(runtime.toasts()).toHaveLength(1);
      runtime.dismissToast(ids[1]!);
      expect(runtime.toasts()).toHaveLength(0);
      void handleA;
      void handleB;
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
