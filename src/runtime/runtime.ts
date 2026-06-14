import { collect, type ChildNode, type Node, type Ui, type WindowNode } from "./collector.ts";
import { toPreact } from "./renderer.tsx";
import type { VNode } from "preact";

export interface Api {
  onRender: () => void;
  ui: Ui;
  requestUpdate: () => void;
  tick: (cb: () => void) => () => void;
}

export interface Runtime {
  loadTool(init: (api: Api) => void): void;
  render(): VNode;
  requestUpdate(): void;
  subscribe(onChange: () => void): () => void;
  lastButton(): Extract<Node, { kind: "button" }>;
  tick(): void;
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
  const subscribers = new Set<() => void>();
  const tickSubscribers = new Set<() => void>();

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

  const noopUi: Ui = {
    window() {},
    label() {},
    button() {},
    row() {},
    textInput() {},
  };

  return {
    loadTool(loader) {
      tickSubscribers.clear();
      api = {
        onRender: () => {},
        ui: noopUi,
        requestUpdate,
        tick: tickSubscribe,
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
    get updateCount() {
      return updates;
    },
  };
}
