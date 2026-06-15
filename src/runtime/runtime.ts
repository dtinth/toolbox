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

export interface Runtime {
  loadTool(init: (api: Api) => void): void;
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

export function createRuntime(): Runtime {
  let api: Api | null = null;
  let lastTree: WindowNode[] = [];
  let lastButtonRef: Extract<Node, { kind: "button" }> | null = null;
  let updates = 0;
  let pendingRender = false;
  let nextToastId = 1;
  const toasts: Toast[] = [];
  const subscribers = new Set<() => void>();
  let zCounter = 0;
  const windowStates = new Map<string, WindowState>();
  let disposed = false;
  const tickSubscribers = new Set<() => void>();
  const autoDismissTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function notify() {
    for (const sub of subscribers) sub();
  }

  function renderOnce(): VNode {
    if (!api) throw new Error("no tool loaded");
    lastTree = collect((collectorUi) => {
      api!.ui = collectorUi;
      try {
        api!.onRender();
      } finally {
        api!.ui = noopUi;
      }
    });
    lastButtonRef = findLastButton(lastTree);
    for (let i = 0; i < lastTree.length; i++) {
      const w = lastTree[i];
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
    return toPreact(lastTree, windowStates, active, focusWindow, moveWindow) as VNode;
  }

  function requestUpdate(): void {
    updates++;
    if (pendingRender) return;
    pendingRender = true;
    queueMicrotask(() => {
      pendingRender = false;
      if (api) {
        renderOnce();
        notify();
      }
    });
  }

  function fireTicks() {
    for (const cb of tickSubscribers) cb();
  }

  function tickSubscribe(cb: () => void): () => void {
    tickSubscribers.add(cb);
    return () => tickSubscribers.delete(cb);
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
    const timer = autoDismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      autoDismissTimers.delete(id);
    }
    requestUpdate();
  }

  function showToast(
    message: string,
    opts?: { loading?: boolean; duration?: number },
  ): ToastHandle {
    const id = nextToastId++;
    const loading = opts?.loading ?? false;
    const duration = opts?.duration ?? 2000;
    const toast: Toast = { id, message, loading, createdAt: Date.now() };
    toasts.push(toast);
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

  const noopUi: Ui = {
    window: Object.assign(() => {}, { setTitle() {}, onClose() {} }),
    label() {},
    button() {},
    row() {},
    textInput() {},
    textarea() {},
  };

  return {
    loadTool(loader) {
      tickSubscribers.clear();
      for (const timer of autoDismissTimers.values()) clearTimeout(timer);
      autoDismissTimers.clear();
      toasts.length = 0;
      windowStates.clear();
      zCounter = 0;
      disposed = false;
      api = {
        onRender: () => {},
        ui: noopUi,
        requestUpdate,
        tick: tickSubscribe,
        toast: { show: showToast },
        dispose: () => {
          disposed = true;
          requestUpdate();
        },
      };
      lastTree = [];
      loader(api);
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
    dispose: () => {
      disposed = true;
      requestUpdate();
    },
    get disposed() {
      return disposed;
    },
  };
}
