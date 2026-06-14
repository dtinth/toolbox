import { collect, type Node, type Ui, type WindowNode } from "./collector.ts";
import { toPreact } from "./renderer.tsx";
import type { VNode } from "preact";

export interface Api {
  onRender: () => void;
  ui: Ui;
  requestUpdate: () => void;
}

export interface Runtime {
  loadTool(init: (api: Api) => void): void;
  render(): VNode;
  requestUpdate(): void;
  lastButton(): Extract<Node, { kind: "button" }>;
  updateCount: number;
}

function findLastButton(windows: WindowNode[]): Extract<Node, { kind: "button" }> | null {
  let last: Extract<Node, { kind: "button" }> | null = null;
  function walk(nodes: Node[]) {
    for (const node of nodes) {
      if (node.kind === "button") last = node;
      else if (node.kind === "window") walk(node.children);
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
      if (api) renderOnce();
    });
  }

  const noopUi: Ui = {
    window() {},
    label() {},
    button() {},
  };

  return {
    loadTool(loader) {
      api = {
        onRender: () => {},
        ui: noopUi,
        requestUpdate,
      };
      lastTree = [];
      loader(api);
    },
    render: renderOnce,
    requestUpdate,
    lastButton: () => {
      if (!lastButtonRef) throw new Error("no button was rendered");
      return lastButtonRef;
    },
    get updateCount() {
      return updates;
    },
  };
}
