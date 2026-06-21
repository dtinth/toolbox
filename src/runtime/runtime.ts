import { collect, ui, type ChildNode, type Node, type Ui, type WindowNode } from "./collector.ts";
import { preactApi } from "./preact-api.ts";
import { toPreact } from "./renderer.tsx";
import type { Preact } from "../../api.d.ts";
import type { VNode } from "preact";
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
  report(value: { message?: string; increment?: number }): void;
}

export interface ProgressOptions {
  title: string;
}

export interface Api {
  onRender: () => void;
  ui: Ui;
  preact: Preact;
  requestUpdate: () => void;
  tick: (cb: () => void) => () => void;
  toast: {
    show(message: string, opts?: { loading?: boolean; duration?: number }): ToastHandle;
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
  launchTool(opts: {
    manifestId: string;
    name: string;
    loader?: (api: Api) => void;
  }): ToolInstanceInfo;
  initializeTool(instanceId: string, loader: (api: Api) => void): void;
  isLoading(instanceId: string): boolean;
  closeTool(instanceId: string): void;
  toolInstances(): ReadonlyArray<ToolInstanceInfo>;
  readonly isEmpty: boolean;
  render(): VNode;
  requestUpdate(): void;
  subscribe(onChange: () => void): () => void;
  tick(): void;
  hasTickSubscribers(): boolean;
  toasts(): Toast[];
  dismissToast(id: number): void;
  pendingPicks(): PickRequest[];
  resolvePick(id: number, index: number | null): void;
  pendingInputs(): InputRequest[];
  resolveInput(id: number, value: string | null): void;
  windowStates: ReadonlyMap<string, WindowState>;
  focusWindow(id: string): void;
  moveWindow(id: string, x: number, y: number): void;
  activeWindowId: string | null;
  dispose(): void;
  readonly disposed: boolean;
}

export interface TestRuntime extends Runtime {
  loadTool(init: (api: Api) => void): void;
  lastButton(): Extract<Node, { kind: "button" }>;
  updateCount: number;
  windowTree: ReadonlyArray<WindowNode>;
}

function findLastButton(windows: WindowNode[]): Extract<Node, { kind: "button" }> | null {
  let last: Extract<Node, { kind: "button" }> | null = null;
  function walk(nodes: ChildNode[]) {
    for (const child of nodes) {
      if (child.kind === "button") last = child;
      else if (child.kind === "window") walk(child.children);
      else if (child.kind === "row") walk(child.children);
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
    onChange: () => requestUpdate(),
  });

  const dialogCenter = createDialogCenter({
    onChange: () => requestUpdate(),
  });

  function notify() {
    for (const sub of subscribers) sub();
  }

  function buildApi(instance: ToolInstance): Api {
    const api: Api = {
      onRender: () => {},
      ui,
      preact: preactApi,
      requestUpdate: () => {
        updates++;
        scheduleRender();
      },
      tick(cb: () => void) {
        instance.tickSubscribers.add(cb);
        return () => instance.tickSubscribers.delete(cb);
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
        } catch (err) {
          handle.dismiss();
          const message = err instanceof Error ? err.message : String(err);
          toastCenter.show(instanceId, `${options.title}: ${message}`, {
            intent: "error",
            duration: 6000,
          });
          throw err;
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
    };
    const api = buildApi(instance);
    instance.api = api;
    instances.set(instanceId, instance);
    instanceOrder.push(instanceId);
    disposed = false;
    if (opts.loader) opts.loader(api);
    scheduleRender();
    return info;
  }

  function initializeTool(instanceId: string, loader: (api: Api) => void): void {
    const instance = instances.get(instanceId);
    if (!instance) return;
    if (instance.state === "ready") return;
    instance.state = "ready";
    loader(instance.api);
    scheduleRender();
  }

  function closeTool(instanceId: string): void {
    const instance = instances.get(instanceId);
    if (!instance) return;
    toastCenter.dismissForInstance(instanceId);
    dialogCenter.cancelForInstance(instanceId);
    instance.tickSubscribers.clear();
    wm.forget(instancePrefix(instanceId));
    instances.delete(instanceId);
    const orderIdx = instanceOrder.indexOf(instanceId);
    if (orderIdx >= 0) instanceOrder.splice(orderIdx, 1);
    if (instanceOrder.length === 0) {
      disposed = true;
      wm.reset();
    }
    scheduleRender();
  }

  function renderOnce(): VNode {
    const allWindows: WindowNode[] = [];
    for (const instanceId of instanceOrder) {
      const instance = instances.get(instanceId);
      if (!instance) continue;
      if (instance.state === "loading") {
        const loadingWindow: WindowNode = {
          kind: "window",
          id: scopeId(instanceId, "__main__"),
          title: instance.info.name,
          children: [{ kind: "spinner" }],
          menus: [],
          onClose: () => instance.api.dispose(),
        };
        allWindows.push(loadingWindow);
        continue;
      }
      // `api.ui` is the stable collector `ui`; `collect` installs the collection
      // context for the duration of this declarator, so `ui.*` works here and
      // throws anywhere else. Returning onRender's result lets collect reject a
      // Promise-returning (async) declarator.
      const instanceWindows = collect(() => instance.onRender(), {
        pick: instance.api.dialog.pick,
      });
      for (const w of instanceWindows) {
        const scoped: WindowNode = { ...w, id: scopeId(instanceId, w.id) };
        if (w.id === "__main__" && !scoped.onClose) {
          scoped.onClose = () => instance.api.dispose();
        }
        allWindows.push(scoped);
      }
    }
    lastTree = allWindows;
    lastButtonRef = findLastButton(allWindows);
    wm.place(allWindows.map((w) => w.id));
    const active = wm.activeId();
    return toPreact(allWindows, wm.states, active, focusWindow, moveWindow) as VNode;
  }

  function requestUpdate(): void {
    updates++;
    scheduleRender();
  }

  function scheduleRender(): void {
    if (pendingRender) return;
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
      if (!instance) continue;
      for (const cb of instance.tickSubscribers) {
        cb();
        fired = true;
      }
    }
    return fired;
  }

  function hasTickSubscribers(): boolean {
    for (const instanceId of instanceOrder) {
      if ((instances.get(instanceId)?.tickSubscribers.size ?? 0) > 0) return true;
    }
    return false;
  }

  function focusWindow(id: string) {
    if (wm.focus(id)) requestUpdate();
  }

  function moveWindow(id: string, x: number, y: number) {
    wm.move(id, x, y);
  }

  return {
    loadTool(loader) {
      for (const id of Array.from(instances.keys())) {
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
    requestUpdate,
    subscribe(onChange) {
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
    lastButton: () => {
      if (!lastButtonRef) throw new Error("no button was rendered");
      return lastButtonRef;
    },
    tick: () => {
      // Only redraw when a tick actually fired — keeps an idle toolbox (no
      // animating tools) from re-rendering every animation frame.
      if (fireTicks()) requestUpdate();
    },
    hasTickSubscribers,
    toasts: () => toastCenter.list(),
    dismissToast: (id) => toastCenter.dismiss(id),
    pendingPicks: () => dialogCenter.list(),
    resolvePick: (id, index) => dialogCenter.resolve(id, index),
    pendingInputs: () => dialogCenter.listInputs(),
    resolveInput: (id, value) => dialogCenter.resolveInput(id, value),
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
      return lastTree as ReadonlyArray<WindowNode>;
    },
    dispose: () => {
      for (const id of Array.from(instances.keys())) {
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
