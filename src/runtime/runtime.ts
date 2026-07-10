import { collect, ui, type ChildNode, type Node, type Ui, type WindowNode } from "./collector.ts";
import { preactApi } from "./preact-api.ts";
import { tw } from "./tw.ts";
import { toPreact, toPreactInstance } from "./renderer.tsx";
import type { Preact } from "../../api.d.ts";
import { type VNode } from "preact";
import {
  createWindowManager,
  instancePrefix,
  scopeId,
  type WindowManager,
  type WindowState,
} from "./window-manager.ts";
import { createToastCenter, type Toast, type ToastHandle } from "./toast-center.ts";
import {
  createDialogCenter,
  type Dialog,
  type InputRequest,
  type PickRequest,
} from "./dialog-center.ts";

export type { WindowState } from "./window-manager.ts";
export type { Toast, ToastHandle } from "./toast-center.ts";
export type {
  Dialog,
  InputOptions,
  InputRequest,
  PickRequest,
  QuickPickItem,
  QuickPickOptions,
} from "./dialog-center.ts";

export interface Progress {
  report: (value: { message?: string; increment?: number }) => void;
}

export interface ProgressOptions {
  title: string;
}

export interface Api {
  onRender: () => void;
  ui: Ui;
  preact: Preact;
  tw: (
    strings: TemplateStringsArray,
    ...exprs: (string | number | false | null | undefined)[]
  ) => string;
  requestUpdate: () => void;
  tick: (cb: () => void) => () => void;
  toast: {
    show: (message: string, opts?: { loading?: boolean; duration?: number }) => ToastHandle;
  };
  dialog: Dialog;
  withProgress: <T>(
    options: ProgressOptions,
    task: (progress: Progress) => Promise<T>,
  ) => Promise<T>;
  dispose: () => void;
}

export interface ToolInstanceInfo {
  instanceId: string;
  manifestId: string;
  name: string;
}

export interface Runtime {
  launchTool: (opts: {
    manifestId: string;
    name: string;
    loader?: (api: Api) => void;
  }) => ToolInstanceInfo;
  initializeTool: (instanceId: string, loader: (api: Api) => void) => void;
  isLoading: (instanceId: string) => boolean;
  closeTool: (instanceId: string) => void;
  toolInstances: () => readonly ToolInstanceInfo[];
  readonly isEmpty: boolean;
  render: () => VNode;
  /** Render a single instance into its own root (ADR-0008); null once gone. */
  renderInstance: (instanceId: string) => VNode | null;
  requestUpdate: () => void;
  subscribe: (onChange: () => void) => () => void;
  tick: () => void;
  hasTickSubscribers: () => boolean;
  toasts: () => Toast[];
  dismissToast: (id: number) => void;
  pendingPicks: () => PickRequest[];
  resolvePick: (id: number, index: number | null) => void;
  pendingInputs: () => InputRequest[];
  resolveInput: (id: number, value: string | null) => void;
  windowStates: ReadonlyMap<string, WindowState>;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  activeWindowId: string | null;
  dispose: () => void;
  readonly disposed: boolean;
}

export interface TestRuntime extends Runtime {
  loadTool: (init: (api: Api) => void) => void;
  lastButton: () => Extract<Node, { kind: "button" }>;
  updateCount: number;
  windowTree: readonly WindowNode[];
}

function findLastButton(windows: WindowNode[]): Extract<Node, { kind: "button" }> | null {
  let last: Extract<Node, { kind: "button" }> | null = null;
  function walk(nodes: ChildNode[]) {
    for (const child of nodes) {
      if (child.kind === "button") {
        last = child;
      } else if (child.kind === "window") {
        walk(child.children);
      } else if (child.kind === "row") {
        walk(child.children);
      }
    }
  }
  walk(windows);
  return last;
}

interface ToolInstance {
  info: ToolInstanceInfo;
  onRender: () => void;
  api: Api;
  tickSubscribers: Set<() => void>;
  state: "loading" | "ready";
  // Per-instance render isolation (ADR-0008): `dirty` marks that this instance's
  // declarator must be re-run; `cache` holds its last collected (scoped) windows
  // so a redraw of one instance never re-runs another's onRender.
  dirty: boolean;
  cache: WindowNode[] | null;
}

// Run one instance's declarator and return its scoped windows. Loading
// instances render a spinner placeholder. `api.ui` is the stable collector
// `ui`; `collect` installs the collection context for the duration of the
// declarator, so `ui.*` works here and throws anywhere else. Returning
// onRender's result lets collect reject a Promise-returning (async) declarator.
function collectInstance(instance: ToolInstance): WindowNode[] {
  const instanceId = instance.info.instanceId;
  if (instance.state === "loading") {
    return [
      {
        kind: "window",
        id: scopeId(instanceId, "__main__"),
        title: instance.info.name,
        children: [{ kind: "spinner" }],
        menus: [],
        onClose: () => {
          instance.api.dispose();
        },
      },
    ];
  }
  const windows = collect(
    () => {
      instance.onRender();
    },
    { pick: instance.api.dialog.pick },
  );
  return windows.map((w) => {
    const originalId = w.id;
    w.id = scopeId(instanceId, originalId);
    if (originalId === "__main__" && !w.onClose) {
      w.onClose = () => {
        instance.api.dispose();
      };
    }
    return w;
  });
}

function build(): TestRuntime {
  const instances = new Map<string, ToolInstance>();
  const instanceOrder: string[] = [];
  let lastButtonRef: Extract<Node, { kind: "button" }> | null = null;
  let lastTree: WindowNode[] = [];
  let updates = 0;
  let pendingRender = false;
  let instanceCounter = 0;
  const subscribers = new Set<() => void>();
  const wm: WindowManager = createWindowManager();
  let disposed = false;

  const toastCenter = createToastCenter({
    onChange: () => {
      requestUpdate();
    },
  });

  const dialogCenter = createDialogCenter({
    onChange: () => {
      requestUpdate();
    },
  });

  function notify() {
    for (const sub of subscribers) {
      sub();
    }
  }

  function buildApi(instance: ToolInstance): Api {
    const api: Api = {
      onRender: () => {},
      ui,
      preact: preactApi,
      tw,
      requestUpdate: () => {
        instance.dirty = true;
        updates++;
        scheduleRender();
      },
      tick(cb: () => void) {
        instance.tickSubscribers.add(cb);
        return () => {
          instance.tickSubscribers.delete(cb);
        };
      },
      toast: {
        show: (message, opts) => toastCenter.show(instance.info.instanceId, message, opts),
      },
      dialog: dialogCenter.forInstance(instance.info.instanceId),
      withProgress: async (options, task) => {
        const instanceId = instance.info.instanceId;
        const handle = toastCenter.show(instanceId, options.title, { loading: true });
        let current = 0;
        const progress: Progress = {
          report({ message, increment }) {
            if (increment !== undefined) {
              current = Math.max(0, Math.min(100, current + increment));
              handle.update({ progress: current, message });
            } else if (message !== undefined) {
              handle.update({ message });
            }
          },
        };
        try {
          const result = await task(progress);
          handle.dismiss();
          return result;
        } catch (error) {
          handle.dismiss();
          const message = error instanceof Error ? error.message : String(error);
          toastCenter.show(instanceId, `${options.title}: ${message}`, {
            intent: "error",
            duration: 6000,
          });
          throw error;
        }
      },
      dispose: () => {
        closeTool(instance.info.instanceId);
      },
    };
    Object.defineProperty(api, "onRender", {
      get: () => instance.onRender,
      set: (fn: () => void) => {
        instance.onRender = fn;
      },
      configurable: true,
      enumerable: true,
    });
    return api;
  }

  function launchTool(opts: {
    manifestId: string;
    name: string;
    loader?: (api: Api) => void;
  }): ToolInstanceInfo {
    instanceCounter++;
    const instanceId = `inst-${instanceCounter}`;
    const info: ToolInstanceInfo = {
      instanceId,
      manifestId: opts.manifestId,
      name: opts.name,
    };
    const instance: ToolInstance = {
      info,
      onRender: () => {},
      api: undefined as unknown as Api,
      tickSubscribers: new Set(),
      state: opts.loader ? "ready" : "loading",
      dirty: true,
      cache: null,
    };
    const api = buildApi(instance);
    instance.api = api;
    instances.set(instanceId, instance);
    instanceOrder.push(instanceId);
    disposed = false;
    if (opts.loader) {
      opts.loader(api);
    }
    scheduleRender();
    return info;
  }

  function initializeTool(instanceId: string, loader: (api: Api) => void): void {
    const instance = instances.get(instanceId);
    if (!instance) {
      return;
    }
    if (instance.state === "ready") {
      return;
    }
    instance.state = "ready";
    instance.dirty = true;
    loader(instance.api);
    scheduleRender();
  }

  function closeTool(instanceId: string): void {
    const instance = instances.get(instanceId);
    if (!instance) {
      return;
    }
    toastCenter.dismissForInstance(instanceId);
    dialogCenter.cancelForInstance(instanceId);
    instance.tickSubscribers.clear();
    wm.forget(instancePrefix(instanceId));
    instances.delete(instanceId);
    const orderIdx = instanceOrder.indexOf(instanceId);
    if (orderIdx !== -1) {
      instanceOrder.splice(orderIdx, 1);
    }
    if (instanceOrder.length === 0) {
      disposed = true;
      wm.reset();
    }
    scheduleRender();
  }

  // The isolation core: re-collect only when the instance is dirty (or has no
  // cache yet); otherwise reuse the cached windows so this instance's onRender
  // is not re-run for another instance's redraw.
  function instanceWindows(instance: ToolInstance): WindowNode[] {
    if (!instance.dirty && instance.cache) {
      return instance.cache;
    }
    const windows = collectInstance(instance);
    instance.cache = windows;
    instance.dirty = false;
    return windows;
  }

  // Combined composition (single root) — used by tests and as a fallback path.
  function renderOnce(): VNode {
    const allWindows: WindowNode[] = [];
    for (const instanceId of instanceOrder) {
      const instance = instances.get(instanceId);
      if (!instance) {
        continue;
      }
      allWindows.push(...instanceWindows(instance));
    }
    lastTree = allWindows;
    lastButtonRef = findLastButton(allWindows);
    wm.place(allWindows.map((w) => w.id));
    const active = wm.activeId();
    return toPreact(allWindows, wm.states, active, focusWindow, moveWindow);
  }

  // Per-instance composition (one Preact root per instance, ADR-0008). Returns
  // that instance's windows as a fragment for the host to mount into the
  // instance's own container; null once the instance is gone.
  function renderInstance(instanceId: string): VNode | null {
    const instance = instances.get(instanceId);
    if (!instance) {
      return null;
    }
    const windows = instanceWindows(instance);
    // Keep lastTree/lastButton coherent for callers that only drive per-instance
    // rendering; placement is idempotent per id.
    wm.place(windows.map((w) => w.id));
    const active = wm.activeId();
    return toPreactInstance(windows, wm.states, active, focusWindow, moveWindow);
  }

  function requestUpdate(): void {
    updates++;
    scheduleRender();
  }

  function scheduleRender(): void {
    if (pendingRender) {
      return;
    }
    pendingRender = true;
    queueMicrotask(() => {
      pendingRender = false;
      if (instanceOrder.length > 0) {
        renderOnce();
      }
      notify();
    });
  }

  function fireTicks(): boolean {
    let fired = false;
    for (const instanceId of instanceOrder) {
      const instance = instances.get(instanceId);
      if (!instance) {
        continue;
      }
      for (const subscriber of instance.tickSubscribers) {
        subscriber();
        fired = true;
        // A tick is an animation frame for this instance — re-collect it.
        instance.dirty = true;
      }
    }
    return fired;
  }

  function hasTickSubscribers(): boolean {
    for (const instanceId of instanceOrder) {
      if ((instances.get(instanceId)?.tickSubscribers.size ?? 0) > 0) {
        return true;
      }
    }
    return false;
  }

  function focusWindow(id: string) {
    if (wm.focus(id)) {
      requestUpdate();
    }
  }

  function moveWindow(id: string, x: number, y: number) {
    wm.move(id, x, y);
  }

  return {
    loadTool(loader) {
      for (const id of instances.keys()) {
        closeTool(id);
      }
      toastCenter.reset();
      dialogCenter.reset();
      wm.reset();
      instanceCounter = 0;
      lastTree = [];
      launchTool({
        manifestId: "__loaded__",
        name: "Loaded",
        loader,
      });
    },
    launchTool,
    initializeTool,
    isLoading: (instanceId: string) => instances.get(instanceId)?.state === "loading",
    closeTool,
    toolInstances: () => instanceOrder.map((id) => instances.get(id)!.info),
    get isEmpty() {
      return instanceOrder.length === 0;
    },
    render: renderOnce,
    renderInstance,
    requestUpdate,
    subscribe(onChange) {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    },
    lastButton: () => {
      if (!lastButtonRef) {
        throw new Error("no button was rendered");
      }
      return lastButtonRef;
    },
    tick: () => {
      // Only redraw when a tick actually fired — keeps an idle toolbox (no
      // animating tools) from re-rendering every animation frame.
      if (fireTicks()) {
        requestUpdate();
      }
    },
    hasTickSubscribers,
    toasts: () => toastCenter.list(),
    dismissToast: (id) => {
      toastCenter.dismiss(id);
    },
    pendingPicks: () => dialogCenter.list(),
    resolvePick: (id, index) => {
      dialogCenter.resolve(id, index);
    },
    pendingInputs: () => dialogCenter.listInputs(),
    resolveInput: (id, value) => {
      dialogCenter.resolveInput(id, value);
    },
    get updateCount() {
      return updates;
    },
    get windowStates() {
      return wm.states;
    },
    focusWindow,
    moveWindow,
    get activeWindowId() {
      return wm.activeId();
    },
    get windowTree() {
      return lastTree as readonly WindowNode[];
    },
    dispose: () => {
      for (const id of instances.keys()) {
        closeTool(id);
      }
      requestUpdate();
    },
    get disposed() {
      return disposed;
    },
  };
}

export function createRuntime(): Runtime {
  return build();
}

export function createTestRuntime(): TestRuntime {
  return build();
}
