import { collect, type ChildNode, type Node, type Ui, type WindowNode } from "./collector.ts";
import { toPreact } from "./renderer.tsx";
import type { VNode } from "preact";

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
    return toPreact(lastTree) as VNode;
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

  const noopUi: Ui = {
    window() {},
    label() {},
    button() {},
    row() {},
    textInput() {},
    textarea() {},
  };

  return {
    loadTool(loader) {
      tickSubscribers.clear();
      // Clear any leftover toasts from a prior tool
      for (const timer of autoDismissTimers.values()) clearTimeout(timer);
      autoDismissTimers.clear();
      toasts.length = 0;
      api = {
        onRender: () => {},
        ui: noopUi,
        requestUpdate,
        tick: tickSubscribe,
        toast: { show: showToast },
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
  };
}
