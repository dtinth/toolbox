import { collect, type ChildNode, type Node, type Ui, type WindowNode } from "./collector.ts";
import { toPreact } from "./renderer.tsx";
import type { VNode } from "preact";

export interface WindowState {
  x: number;
  y: number;
  zIndex: number;
}

export interface ToastHandle {
  update(opts: { message?: string; loading?: boolean }): void;
  dismiss(): void;
}

export interface Toast {
  id: number;
  message: string;
  loading: boolean;
  createdAt: number;
}

export interface Api {
  onRender: () => void;
  ui: Ui;
  requestUpdate: () => void;
  tick: (cb: () => void) => () => void;
  toast: {
    show(message: string, opts?: { loading?: boolean; duration?: number }): ToastHandle;
  };
  dispose: () => void;
}

export interface ToolInstanceInfo {
  instanceId: string;
  manifestId: string;
  name: string;
}

export interface Runtime {
  loadTool(init: (api: Api) => void): void;
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
  lastButton(): Extract<Node, { kind: "button" }>;
  tick(): void;
  toasts(): Toast[];
  dismissToast(id: number): void;
  updateCount: number;
  windowStates: ReadonlyMap<string, WindowState>;
  focusWindow(id: string): void;
  moveWindow(id: string, x: number, y: number): void;
  activeWindowId: string | null;
  windowTree: ReadonlyArray<WindowNode>;
  dispose(): void;
  readonly disposed: boolean;
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

// Scoped window id format: `${instanceId}::${originalId}`.
function scopeId(instanceId: string, originalId: string): string {
  return `${instanceId}::${originalId}`;
}

function instancePrefix(instanceId: string): string {
  return `${instanceId}::`;
}

interface ToolInstance {
  info: ToolInstanceInfo;
  onRender: () => void;
  api: Api;
  tickSubscribers: Set<() => void>;
  toastIds: Set<number>;
  state: "loading" | "ready";
}

export function createRuntime(): Runtime {
  const instances = new Map<string, ToolInstance>();
  const instanceOrder: string[] = [];
  let lastButtonRef: Extract<Node, { kind: "button" }> | null = null;
  let lastTree: WindowNode[] = [];
  let updates = 0;
  let pendingRender = false;
  let nextToastId = 1;
  let instanceCounter = 0;
  const toasts: Toast[] = [];
  const subscribers = new Set<() => void>();
  let zCounter = 0;
  const windowStates = new Map<string, WindowState>();
  let disposed = false;
  const autoDismissTimers = new Map<number, ReturnType<typeof setTimeout>>();

  const noopUi: Ui = {
    window: Object.assign(() => {}, { setTitle() {}, onClose() {} }),
    label() {},
    button() {},
    row() {},
    textInput() {},
    textarea() {},
  };

  function notify() {
    for (const sub of subscribers) sub();
  }

  function buildApi(instance: ToolInstance): Api {
    const api: Api = {
      onRender: () => {},
      ui: noopUi,
      requestUpdate: () => {
        updates++;
        scheduleRender();
      },
      tick(cb: () => void) {
        instance.tickSubscribers.add(cb);
        return () => instance.tickSubscribers.delete(cb);
      },
      toast: {
        show: (message, opts) => showToast(message, opts, instance),
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
      toastIds: new Set(),
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
    for (const id of Array.from(instance.toastIds)) {
      dismissToastInternal(id);
    }
    instance.tickSubscribers.clear();
    const prefix = instancePrefix(instanceId);
    for (const key of Array.from(windowStates.keys())) {
      if (key.startsWith(prefix)) windowStates.delete(key);
    }
    instances.delete(instanceId);
    const orderIdx = instanceOrder.indexOf(instanceId);
    if (orderIdx >= 0) instanceOrder.splice(orderIdx, 1);
    if (instanceOrder.length === 0) {
      disposed = true;
      zCounter = 0;
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
          onClose: () => instance.api.dispose(),
        };
        allWindows.push(loadingWindow);
        continue;
      }
      const instanceWindows = collect((collectorUi) => {
        const previousUi = instance.api.ui;
        instance.api.ui = collectorUi;
        try {
          instance.onRender();
        } finally {
          instance.api.ui = previousUi;
        }
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
    for (let i = 0; i < allWindows.length; i++) {
      const w = allWindows[i];
      if (!windowStates.has(w.id)) {
        const cx = (globalThis.window?.innerWidth ?? 800) / 2 - 150;
        const cy = (globalThis.window?.innerHeight ?? 600) / 2 - 100;
        const offset = i === 0 ? 0 : (i - 1) * 30;
        windowStates.set(w.id, {
          x: cx + offset,
          y: cy + offset,
          zIndex: i === 0 ? 0 : ++zCounter,
        });
      }
    }
    const active = getActiveWindowId();
    return toPreact(allWindows, windowStates, active, focusWindow, moveWindow) as VNode;
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

  function fireTicks() {
    for (const instanceId of instanceOrder) {
      const instance = instances.get(instanceId);
      if (!instance) continue;
      for (const cb of instance.tickSubscribers) cb();
    }
  }

  function scheduleAutoDismiss(id: number, duration: number) {
    const timer = setTimeout(() => {
      dismissToastInternal(id);
    }, duration);
    autoDismissTimers.set(id, timer);
  }

  function dismissToastInternal(id: number): void {
    const i = toasts.findIndex((t) => t.id === id);
    if (i < 0) return;
    toasts.splice(i, 1);
    for (const instance of instances.values()) {
      instance.toastIds.delete(id);
    }
    const timer = autoDismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      autoDismissTimers.delete(id);
    }
    requestUpdate();
  }

  function showToast(
    message: string,
    opts: { loading?: boolean; duration?: number } | undefined,
    instance: ToolInstance,
  ): ToastHandle {
    const id = nextToastId++;
    const loading = opts?.loading ?? false;
    const duration = opts?.duration ?? 2000;
    const toast: Toast = { id, message, loading, createdAt: Date.now() };
    toasts.push(toast);
    instance.toastIds.add(id);
    if (!loading) scheduleAutoDismiss(id, duration);
    requestUpdate();
    return {
      update(updateOpts) {
        const t = toasts.find((x) => x.id === id);
        if (!t) return;
        if (updateOpts.message !== undefined) t.message = updateOpts.message;
        if (updateOpts.loading !== undefined) {
          t.loading = updateOpts.loading;
          if (updateOpts.loading) {
            const timer = autoDismissTimers.get(id);
            if (timer) {
              clearTimeout(timer);
              autoDismissTimers.delete(id);
            }
          } else {
            scheduleAutoDismiss(id, duration);
          }
        }
        requestUpdate();
      },
      dismiss() {
        dismissToastInternal(id);
      },
    };
  }

  function focusWindow(id: string) {
    const state = windowStates.get(id);
    if (state) {
      const maxZ = Math.max(...Array.from(windowStates.values(), (s: WindowState) => s.zIndex), 0);
      if (state.zIndex < maxZ) {
        state.zIndex = ++zCounter;
        requestUpdate();
      }
    }
  }

  function getActiveWindowId(): string | null {
    let maxZ = -1;
    let active: string | null = null;
    for (const [id, state] of windowStates) {
      if (state.zIndex > maxZ) {
        maxZ = state.zIndex;
        active = id;
      }
    }
    return active;
  }

  function moveWindow(id: string, x: number, y: number) {
    const state = windowStates.get(id);
    if (state) {
      state.x = x;
      state.y = y;
    }
  }

  return {
    loadTool(loader) {
      for (const id of Array.from(instances.keys())) {
        closeTool(id);
      }
      for (const timer of autoDismissTimers.values()) clearTimeout(timer);
      autoDismissTimers.clear();
      toasts.length = 0;
      windowStates.clear();
      zCounter = 0;
      instanceCounter = 0;
      nextToastId = 1;
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
      fireTicks();
      requestUpdate();
    },
    toasts: () => toasts.slice(),
    dismissToast: dismissToastInternal,
    get updateCount() {
      return updates;
    },
    get windowStates() {
      return windowStates as ReadonlyMap<string, WindowState>;
    },
    focusWindow,
    moveWindow,
    get activeWindowId() {
      return getActiveWindowId();
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
