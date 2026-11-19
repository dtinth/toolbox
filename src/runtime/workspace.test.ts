import { describe, expect, it, vi } from "vite-plus/test";
import { leaf, split } from "./layout-tree.ts";
import { createTestRuntime, type Api, type Runtime } from "./runtime.ts";
import {
  autosave,
  createWorkspaceStore,
  parseWorkspace,
  pruneWorkspace,
  restoreWorkspace,
  snapshot,
  WORKSPACE_VERSION,
  type SavedTool,
  type Workspace,
  type WorkspaceStorage,
} from "./workspace.ts";

const slot = { x: 10, y: 20, zIndex: 1, width: null, height: null };

function workspace(over: Partial<Workspace> = {}): Workspace {
  return {
    version: WORKSPACE_VERSION,
    tools: [{ instanceId: "i1", manifestId: "counter" }],
    slots: { "i1::__main__": slot },
    layout: null,
    ...over,
  };
}

function fail(): never {
  throw new Error("blocked");
}

function memoryStorage(): WorkspaceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** A tool that draws its main window, and a sub-window while `sub` is on. */
function tool(sub = false) {
  return (api: Api) => {
    api.onRender = () => {
      api.ui.window.setTitle("Main");
      if (sub) {
        api.ui.window("sub", "Sub", () => {});
      }
    };
  };
}

async function settle(runtime: Runtime) {
  runtime.requestUpdate();
  await Promise.resolve();
  await Promise.resolve();
}

function launcher(runtime: Runtime, sub = false) {
  return (saved: SavedTool) => {
    runtime.launchTool({
      instanceId: saved.instanceId,
      manifestId: saved.manifestId,
      name: saved.manifestId,
      loader: tool(sub),
    });
  };
}

describe("parseWorkspace", () => {
  it("reads back what was written", () => {
    const ws = workspace({ layout: leaf(["i1::__main__"]) });
    expect(parseWorkspace(JSON.stringify(ws))).toStrictEqual(ws);
  });

  it("gives null for nothing stored, bad JSON, or a wrong shape", () => {
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace("{nope")).toBeNull();
    expect(parseWorkspace("[]")).toBeNull();
    expect(
      parseWorkspace(JSON.stringify({ ...workspace(), tools: [{ instanceId: 1 }] })),
    ).toBeNull();
    expect(
      parseWorkspace(JSON.stringify({ ...workspace(), slots: { a: { ...slot, x: "1" } } })),
    ).toBeNull();
    expect(
      parseWorkspace(JSON.stringify({ ...workspace(), layout: { type: "leaf", tabs: [1] } })),
    ).toBeNull();
  });

  it("gives null for a version it has no way to reach, which resets it", () => {
    expect(parseWorkspace(JSON.stringify({ ...workspace(), version: 0 }))).toBeNull();
    expect(parseWorkspace(JSON.stringify({ ...workspace(), version: 99 }))).toBeNull();
  });

  it("runs migrations up to the current version", () => {
    const old = { version: 0, apps: [{ instanceId: "i1", manifestId: "counter" }], slots: {} };
    const parsed = parseWorkspace(JSON.stringify(old), {
      0: ({ apps, ...rest }) => ({ ...rest, version: 1, tools: apps, layout: null }),
    });
    expect(parsed?.tools).toStrictEqual([{ instanceId: "i1", manifestId: "counter" }]);
  });

  it("repairs a stored tree instead of trusting it", () => {
    const layout = { type: "split", direction: "row", children: [leaf(["a"])], sizes: [-1] };
    expect(
      parseWorkspace(JSON.stringify(workspace({ layout: layout as never })))?.layout,
    ).toStrictEqual(leaf(["a"]));
  });
});

describe("pruneWorkspace", () => {
  it("drops a Tool gone from the Manifest, with its Slots and tabs", () => {
    const ws = workspace({
      tools: [
        { instanceId: "i1", manifestId: "counter" },
        { instanceId: "i2", manifestId: "gone" },
      ],
      slots: { "i1::__main__": slot, "i2::__main__": slot },
      layout: split("row", [leaf(["i1::__main__"]), leaf(["i2::__main__"])]),
    });
    const pruned = pruneWorkspace(ws, new Set(["counter"]));
    expect(pruned.tools).toStrictEqual([{ instanceId: "i1", manifestId: "counter" }]);
    expect(Object.keys(pruned.slots)).toStrictEqual(["i1::__main__"]);
    expect(pruned.layout).toStrictEqual(leaf(["i1::__main__"]));
  });

  it("drops Slots and tabs that belong to no saved Tool", () => {
    const ws = workspace({
      slots: { "i1::__main__": slot, "stray::__main__": slot },
      layout: leaf(["i1::__main__", "stray::__main__", "no-slot"]),
    });
    const pruned = pruneWorkspace(ws, new Set(["counter"]));
    expect(Object.keys(pruned.slots)).toStrictEqual(["i1::__main__"]);
    expect(pruned.layout).toStrictEqual(leaf(["i1::__main__"]));
  });

  it("keeps only the first of two Tools with one instance id", () => {
    const ws = workspace({
      tools: [
        { instanceId: "i1", manifestId: "counter" },
        { instanceId: "i1", manifestId: "counter" },
      ],
    });
    expect(pruneWorkspace(ws, new Set(["counter"])).tools).toHaveLength(1);
  });
});

describe("snapshot and restore", () => {
  it("brings back the Tools, where their Windows were, and the tree", async () => {
    const before = createTestRuntime();
    before.setDockingEnabled(true);
    launcher(before, true)({ instanceId: "i1", manifestId: "counter" });
    launcher(before)({ instanceId: "i2", manifestId: "clock" });
    await settle(before);
    before.moveWindow("i1::__main__", 111, 222);
    before.resizeWindow("i1::__main__", 333, 444);
    before.dockWindow("i2::__main__", { kind: "edge", side: "left" });
    before.dockWindow("i1::sub", { kind: "tab", pane: "i2::__main__" });
    const saved = snapshot(before);

    const after = createTestRuntime();
    after.setDockingEnabled(true);
    restoreWorkspace(after, saved, new Set(["counter", "clock"]), (t) => {
      launcher(after, t.instanceId === "i1")(t);
    });
    await settle(after);

    expect(after.toolInstances().map((t) => t.instanceId)).toStrictEqual(["i1", "i2"]);
    expect(after.slots.get("i1::__main__")).toMatchObject({
      x: 111,
      y: 222,
      width: 333,
      height: 444,
      present: true,
    });
    expect(after.layout).toStrictEqual(saved.layout);
    expect(snapshot(after)).toStrictEqual(saved);
  });

  it("keeps a Slot dormant until its Tool draws it", async () => {
    const runtime = createTestRuntime();
    runtime.adoptArrangement(workspace({ layout: leaf(["i1::__main__"]) }));
    await settle(runtime);
    expect(runtime.slots.get("i1::__main__")?.present).toBeFalsy();
    expect(runtime.layout).toStrictEqual(leaf(["i1::__main__"]));
    launcher(runtime)({ instanceId: "i1", manifestId: "counter" });
    await settle(runtime);
    expect(runtime.slots.get("i1::__main__")).toMatchObject({ x: 10, y: 20, present: true });
  });

  it("puts a new window on top of every restored one", async () => {
    const runtime = createTestRuntime();
    runtime.adoptArrangement(workspace({ slots: { "i1::__main__": { ...slot, zIndex: 50 } } }));
    launcher(runtime)({ instanceId: "i1", manifestId: "counter" });
    launcher(runtime)({ instanceId: "i2", manifestId: "counter" });
    await settle(runtime);
    expect(runtime.slots.get("i2::__main__")?.zIndex).toBeGreaterThan(50);
  });
});

describe("createWorkspaceStore", () => {
  it("saves, loads and resets one Workspace per id", () => {
    const storage = memoryStorage();
    const store = createWorkspaceStore(storage);
    store.save("work", workspace());
    expect(store.load("work")).toStrictEqual(workspace());
    expect(store.load("home")).toBeNull();
    store.reset("work");
    expect(store.load("work")).toBeNull();
  });

  it("keeps working when storage throws", () => {
    const store = createWorkspaceStore({ getItem: fail, setItem: fail, removeItem: fail });
    expect(() => {
      store.save("w", workspace());
      store.reset("w");
    }).not.toThrow();
    expect(store.load("w")).toBeNull();
  });
});

describe("autosave", () => {
  it("saves once after a burst of changes, moves included", async () => {
    vi.useFakeTimers();
    try {
      const runtime = createTestRuntime();
      const saves: Workspace[] = [];
      const saver = autosave(
        runtime,
        (ws) => {
          saves.push(ws);
        },
        300,
      );
      launcher(runtime)({ instanceId: "i1", manifestId: "counter" });
      await settle(runtime);
      vi.advanceTimersByTime(300);
      expect(saves).toHaveLength(1);

      runtime.moveWindow("i1::__main__", 5, 6);
      runtime.moveWindow("i1::__main__", 7, 8);
      vi.advanceTimersByTime(299);
      expect(saves).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(saves).toHaveLength(2);
      expect(saves[1].slots["i1::__main__"]).toMatchObject({ x: 7, y: 8 });

      saver.stop();
      runtime.moveWindow("i1::__main__", 9, 9);
      vi.advanceTimersByTime(300);
      expect(saves).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips a save when nothing stored would change", async () => {
    vi.useFakeTimers();
    try {
      const runtime = createTestRuntime();
      const saves: Workspace[] = [];
      autosave(
        runtime,
        (ws) => {
          saves.push(ws);
        },
        300,
      );
      launcher(runtime)({ instanceId: "i1", manifestId: "counter" });
      await settle(runtime);
      vi.advanceTimersByTime(300);
      runtime.requestUpdate();
      await settle(runtime);
      vi.advanceTimersByTime(300);
      expect(saves).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves an empty Workspace once the last Tool closes", async () => {
    vi.useFakeTimers();
    try {
      const runtime = createTestRuntime();
      const saves: Workspace[] = [];
      const saver = autosave(
        runtime,
        (ws) => {
          saves.push(ws);
        },
        300,
      );
      launcher(runtime)({ instanceId: "i1", manifestId: "counter" });
      await settle(runtime);
      runtime.closeTool("i1");
      await settle(runtime);
      saver.flush();
      expect(saves.at(-1)).toStrictEqual({
        version: WORKSPACE_VERSION,
        tools: [],
        slots: {},
        layout: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
