import { describe, expect, it } from "vite-plus/test";
import { createTestRuntime } from "./runtime.ts";
import type { Ui } from "./collector.ts";
import { launchToolFromModule } from "./launch.ts";
import type { ToolModule } from "./tool-loader.ts";
import type { Api } from "./runtime.ts";

describe("runtime", () => {
  it("passes an api object with onRender, ui, and requestUpdate", () => {
    const runtime = createTestRuntime();
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

  it("exposes a reactive surface (api.preact) with working signals", () => {
    const runtime = createTestRuntime();
    let captured: Api | null = null;
    runtime.loadTool((api) => {
      captured = api;
    });
    const preact = captured!.preact;
    const count = preact.signal(1);
    expect(count.value).toBe(1);
    count.value = 5;
    expect(count.value).toBe(5);
    const doubled = preact.computed(() => count.value * 2);
    expect(doubled.value).toBe(10);
    expect(typeof preact.h).toBe("function");
  });

  it("captures a button click handler and runs requestUpdate on click", () => {
    const runtime = createTestRuntime();
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
    const runtime = createTestRuntime();
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
    const runtime = createTestRuntime();
    expect(() => runtime.requestUpdate()).not.toThrow();
  });

  it("api.tick(cb) registers a callback that fires when manually ticked", () => {
    const runtime = createTestRuntime();
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
    const runtime = createTestRuntime();
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
    const runtime = createTestRuntime();
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

  it("tick() does not redraw when no tool has a tick subscriber", () => {
    const runtime = createTestRuntime();
    runtime.loadTool((api) => {
      api.onRender = () => {};
    });
    runtime.render();
    expect(runtime.hasTickSubscribers()).toBe(false);
    const before = runtime.updateCount;
    runtime.tick();
    expect(runtime.updateCount).toBe(before);
  });

  it("hasTickSubscribers tracks subscriptions; tick() redraws only while subscribed", () => {
    const runtime = createTestRuntime();
    let unsub = () => {};
    runtime.loadTool((api) => {
      api.onRender = () => {};
      unsub = api.tick(() => {});
    });
    expect(runtime.hasTickSubscribers()).toBe(true);

    const before = runtime.updateCount;
    runtime.tick();
    expect(runtime.updateCount).toBeGreaterThan(before);

    unsub();
    expect(runtime.hasTickSubscribers()).toBe(false);
    const after = runtime.updateCount;
    runtime.tick();
    expect(runtime.updateCount).toBe(after);
  });

  it("api.toast.show returns a handle with update and dismiss", () => {
    const runtime = createTestRuntime();
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
    const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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
      const runtime = createTestRuntime();
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

    it("loadTool still works and resets prior state", () => {
      const runtime = createTestRuntime();
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
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.label("loaded");
        };
      });
      runtime.render();
      expect(runtime.toolInstances()).toHaveLength(1);
      expect(runtime.windowStates.size).toBe(1);
    });

    it("per-instance api.dispose() removes that instance; last disposal flips disposed true", () => {
      const runtime = createTestRuntime();
      let firstApi: { dispose: () => void } | null = null;
      let secondApi: { dispose: () => void } | null = null;
      runtime.launchTool({
        manifestId: "a",
        name: "A",
        loader: (api) => {
          api.onRender = () => {};
          firstApi = api;
        },
      });
      runtime.launchTool({
        manifestId: "b",
        name: "B",
        loader: (api) => {
          api.onRender = () => {};
          secondApi = api;
        },
      });
      runtime.render();
      expect(runtime.toolInstances()).toHaveLength(2);
      firstApi!.dispose();
      expect(runtime.toolInstances()).toHaveLength(1);
      expect(runtime.disposed).toBe(false);
      secondApi!.dispose();
      expect(runtime.toolInstances()).toHaveLength(0);
      expect(runtime.isEmpty).toBe(true);
      expect(runtime.disposed).toBe(true);
    });
  });

  describe("launchToolFromModule", () => {
    it("adds the tool to toolInstances() and preserves manifest id and name", () => {
      const runtime = createTestRuntime();
      const mod: ToolModule = { default: () => {} };
      const entry = { id: "counter", name: "Counter" };
      const info = launchToolFromModule(runtime, entry, mod);
      expect(info.manifestId).toBe("counter");
      expect(info.name).toBe("Counter");
      expect(info.instanceId).toBeTypeOf("string");
      expect(runtime.toolInstances()).toHaveLength(1);
      expect(runtime.toolInstances()[0]).toEqual(info);
    });

    it("calls the module's default(api) with a real runtime Api", () => {
      const runtime = createTestRuntime();
      let receivedApi: Api | null = null;
      const mod: ToolModule = {
        default: (api) => {
          receivedApi = api;
        },
      };
      launchToolFromModule(runtime, { id: "x", name: "X" }, mod);
      expect(receivedApi).not.toBeNull();
      expect(receivedApi!.ui).toBeTypeOf("object");
      expect(typeof receivedApi!.ui.button).toBe("function");
      expect(typeof receivedApi!.ui.label).toBe("function");
      expect(typeof receivedApi!.requestUpdate).toBe("function");
      expect(typeof receivedApi!.dispose).toBe("function");
    });

    it("closing the returned instanceId disposes it from toolInstances()", () => {
      const runtime = createTestRuntime();
      const mod: ToolModule = { default: () => {} };
      const info = launchToolFromModule(runtime, { id: "x", name: "X" }, mod);
      expect(runtime.toolInstances()).toHaveLength(1);
      runtime.closeTool(info.instanceId);
      expect(runtime.toolInstances()).toHaveLength(0);
      expect(runtime.isEmpty).toBe(true);
    });

    it("launching the same manifestId twice creates two separate instances", () => {
      const runtime = createTestRuntime();
      const mod: ToolModule = { default: () => {} };
      const entry = { id: "counter", name: "Counter" };
      const a = launchToolFromModule(runtime, entry, mod);
      const b = launchToolFromModule(runtime, entry, mod);
      expect(a.instanceId).not.toBe(b.instanceId);
      expect(runtime.toolInstances()).toHaveLength(2);
      const ids = runtime.toolInstances().map((i) => i.instanceId);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe("main window close", () => {
    it("attaches a default onClose to the main window that disposes the instance", () => {
      const runtime = createTestRuntime();
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.window.setTitle("Counter");
          api.ui.label("count: 0");
        };
      });
      runtime.render();
      const tree = runtime.windowTree;
      const main = tree.find((w) => w.id.endsWith("::__main__"));
      expect(main).toBeTruthy();
      expect(main!.onClose).toBeTypeOf("function");
      expect(runtime.toolInstances()).toHaveLength(1);
      main!.onClose!();
      expect(runtime.toolInstances()).toHaveLength(0);
      expect(runtime.disposed).toBe(true);
    });

    it("does not override an explicit onClose set via ui.window.onClose", () => {
      const runtime = createTestRuntime();
      let calls = 0;
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.window.setTitle("Counter");
          api.ui.window.onClose(() => {
            calls++;
          });
          api.ui.label("hi");
        };
      });
      runtime.render();
      const main = runtime.windowTree.find((w) => w.id.endsWith("::__main__"));
      expect(main).toBeTruthy();
      main!.onClose!();
      expect(calls).toBe(1);
      expect(runtime.toolInstances()).toHaveLength(1);
    });

    it("only attaches the default to the main window, not sub-windows", () => {
      const runtime = createTestRuntime();
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.window.setTitle("Counter");
          api.ui.label("main");
          api.ui.window("sub1", "Sub", () => {
            api.ui.label("sub");
          });
        };
      });
      runtime.render();
      const tree = runtime.windowTree;
      const main = tree.find((w) => w.id.endsWith("::__main__"));
      const sub = tree.find((w) => w.id.endsWith("::sub1"));
      expect(main!.onClose).toBeTypeOf("function");
      expect(sub!.onClose).toBeUndefined();
    });
  });

  describe("dispose", () => {
    it("api.dispose() marks the runtime as disposed", () => {
      const runtime = createTestRuntime();
      expect(runtime.disposed).toBe(false);
      runtime.loadTool((api) => {
        api.onRender = () => {};
        api.dispose();
      });
      expect(runtime.disposed).toBe(true);
    });

    it("dispose() triggers a redraw (updateCount increments)", () => {
      const runtime = createTestRuntime();
      runtime.loadTool((api) => {
        api.onRender = () => {};
      });
      const before = runtime.updateCount;
      runtime.dispose();
      expect(runtime.updateCount).toBeGreaterThan(before);
    });
  });

  describe("loading state", () => {
    it("launchTool without a loader creates a loading instance shown immediately", () => {
      const runtime = createTestRuntime();
      const info = runtime.launchTool({ manifestId: "counter", name: "Counter" });
      expect(runtime.toolInstances()).toHaveLength(1);
      expect(runtime.toolInstances()[0]).toEqual(info);
      runtime.render();
      const main = runtime.windowTree.find((w) => w.id.endsWith("::__main__"));
      expect(main).toBeTruthy();
      expect(main!.title).toBe("Counter");
      expect(main!.children.some((c) => c.kind === "spinner")).toBe(true);
    });

    it("initializeTool transitions a loading instance to ready and calls the loader", () => {
      const runtime = createTestRuntime();
      const info = runtime.launchTool({ manifestId: "counter", name: "Counter" });
      let called = false;
      runtime.initializeTool(info.instanceId, (api) => {
        called = true;
        api.onRender = () => {
          api.ui.window.setTitle("Counter");
          api.ui.label("ready");
        };
      });
      expect(called).toBe(true);
      runtime.render();
      const main = runtime.windowTree.find((w) => w.id.endsWith("::__main__"));
      expect(main).toBeTruthy();
      expect(main!.children.some((c) => c.kind === "spinner")).toBe(false);
      expect(main!.children.some((c) => c.kind === "label" && c.text === "ready")).toBe(true);
    });

    it("a loading instance can be closed via the default main-window close button", () => {
      const runtime = createTestRuntime();
      const info = runtime.launchTool({ manifestId: "counter", name: "Counter" });
      runtime.render();
      const main = runtime.windowTree.find((w) => w.id.endsWith("::__main__"));
      expect(main!.onClose).toBeTypeOf("function");
      main!.onClose!();
      expect(runtime.toolInstances()).toHaveLength(0);
      expect(info.instanceId).toBeTruthy();
    });

    it("isLoading reports the instance's state", () => {
      const runtime = createTestRuntime();
      const info = runtime.launchTool({ manifestId: "counter", name: "Counter" });
      expect(runtime.isLoading(info.instanceId)).toBe(true);
      runtime.initializeTool(info.instanceId, (api) => {
        api.onRender = () => {};
      });
      expect(runtime.isLoading(info.instanceId)).toBe(false);
    });

    it("initializeTool on a missing instance is a no-op", () => {
      const runtime = createTestRuntime();
      let called = false;
      runtime.initializeTool("does-not-exist", () => {
        called = true;
      });
      expect(called).toBe(false);
    });
  });

  describe("withProgress", () => {
    it("shows a progress toast, applies increments, resolves and dismisses", async () => {
      const runtime = createTestRuntime();
      let api!: Api;
      runtime.loadTool((a) => {
        api = a;
        a.onRender = () => {};
      });

      const result = await api.withProgress({ title: "Loading" }, async (progress) => {
        expect(runtime.toasts()).toHaveLength(1);
        expect(runtime.toasts()[0]!.message).toBe("Loading");
        progress.report({ increment: 50, message: "half" });
        expect(runtime.toasts()[0]!.progress).toBe(50);
        progress.report({ increment: 80 }); // clamps at 100
        expect(runtime.toasts()[0]!.progress).toBe(100);
        return "done";
      });

      expect(result).toBe("done");
      expect(runtime.toasts()).toHaveLength(0);
    });

    it("shows an error toast and rethrows when the task throws", async () => {
      const runtime = createTestRuntime();
      let api!: Api;
      runtime.loadTool((a) => {
        api = a;
        a.onRender = () => {};
      });

      await expect(
        api.withProgress({ title: "Fetch" }, () => Promise.reject(new Error("nope"))),
      ).rejects.toThrow("nope");

      const toasts = runtime.toasts();
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.intent).toBe("error");
      expect(toasts[0]!.message).toContain("nope");
    });
  });

  describe("dialog.pick", () => {
    it("surfaces a pending pick and resolves it on selection", async () => {
      const runtime = createTestRuntime();
      let pick!: Promise<{ label: string } | undefined>;
      runtime.loadTool((api) => {
        api.onRender = () => {};
        pick = api.dialog.pick([{ label: "X" }, { label: "Y" }], { title: "Pick one" });
      });

      const pending = runtime.pendingPicks();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.options.title).toBe("Pick one");

      runtime.resolvePick(pending[0]!.id, 1);
      await expect(pick).resolves.toEqual({ label: "Y" });
      expect(runtime.pendingPicks()).toHaveLength(0);
    });

    it("resolves undefined when the pick is dismissed", async () => {
      const runtime = createTestRuntime();
      let pick!: Promise<{ label: string } | undefined>;
      runtime.loadTool((api) => {
        api.onRender = () => {};
        pick = api.dialog.pick([{ label: "X" }]);
      });
      runtime.resolvePick(runtime.pendingPicks()[0]!.id, null);
      await expect(pick).resolves.toBeUndefined();
    });

    it("routes multiple candidates from ui.file through api.dialog.pick", async () => {
      const runtime = createTestRuntime();
      const delivered: File[] = [];
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.file(null, { onFile: (f) => delivered.push(f) });
        };
      });
      runtime.render();

      const fileNode = runtime.windowTree[0]!.children.find((c) => c.kind === "file");
      if (!fileNode || fileNode.kind !== "file") throw new Error("expected a file node");

      const a = new File(["a"], "a.txt");
      const b = new File(["b"], "b.txt");
      fileNode.resolve([a, b]);

      const picks = runtime.pendingPicks();
      expect(picks).toHaveLength(1);
      expect(picks[0]!.items).toHaveLength(2);

      runtime.resolvePick(picks[0]!.id, 1);
      await new Promise((r) => setTimeout(r, 0));
      expect(delivered).toEqual([b]);
    });

    it("delivers a single candidate from ui.file directly, without a pick", () => {
      const runtime = createTestRuntime();
      const delivered: File[] = [];
      runtime.loadTool((api) => {
        api.onRender = () => {
          api.ui.file(null, { onFile: (f) => delivered.push(f) });
        };
      });
      runtime.render();
      const fileNode = runtime.windowTree[0]!.children.find((c) => c.kind === "file");
      if (!fileNode || fileNode.kind !== "file") throw new Error("expected a file node");
      const only = new File(["x"], "x.txt");
      fileNode.resolve([only]);
      expect(runtime.pendingPicks()).toHaveLength(0);
      expect(delivered).toEqual([only]);
    });

    it("cancels a tool's pending picks (undefined) when it closes", async () => {
      const runtime = createTestRuntime();
      let pick!: Promise<{ label: string } | undefined>;
      const info = runtime.launchTool({
        manifestId: "m",
        name: "N",
        loader: (api) => {
          api.onRender = () => {};
          pick = api.dialog.pick([{ label: "X" }]);
        },
      });
      expect(runtime.pendingPicks()).toHaveLength(1);
      runtime.closeTool(info.instanceId);
      await expect(pick).resolves.toBeUndefined();
      expect(runtime.pendingPicks()).toHaveLength(0);
    });
  });
});
