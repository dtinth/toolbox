import { h, type VNode } from "preact";
import type { ChildNode, Node, WindowNode } from "./collector.ts";
import type { WindowState } from "./runtime.ts";

function nodeToPreact(
  node: Node,
  windowStates: ReadonlyMap<string, WindowState>,
  activeWindowId: string | null,
  onFocusWindow: (id: string) => void,
  onMoveWindow: (id: string, x: number, y: number) => void,
): VNode {
  switch (node.kind) {
    case "label":
      return h("div", null, node.text) as VNode;
    case "button":
      return h(
        "button",
        {
          class:
            "bg-toolbox-content border border-toolbox-border-light rounded px-3 py-1.5 text-sm text-toolbox-text hover:bg-[#454443] active:bg-toolbox-deepest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused",
          onClick: node.onClick,
        },
        node.label,
      ) as VNode;
    case "row":
      return h(
        "div",
        { class: "flex flex-row items-center gap-2" },
        ...node.children.map((child) =>
          childToPreact(child, windowStates, activeWindowId, onFocusWindow, onMoveWindow),
        ),
      ) as VNode;
    case "textInput":
      return h("input", {
        type: "text",
        value: node.value,
        placeholder: node.placeholder,
        onInput: (e: Event) => {
          const target = e.currentTarget as HTMLInputElement;
          node.onChange?.(target.value);
        },
        class:
          "bg-toolbox-deepest border border-toolbox-border rounded px-2 py-1 text-sm text-toolbox-text placeholder-toolbox-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused",
      }) as VNode;
    case "textarea":
      return h("textarea", {
        value: node.value,
        placeholder: node.placeholder,
        rows: node.rows ?? 6,
        onInput: (e: Event) => {
          const target = e.currentTarget as HTMLTextAreaElement;
          node.onChange?.(target.value);
        },
        class:
          "bg-toolbox-deepest border border-toolbox-border rounded px-2 py-1 text-sm text-toolbox-text placeholder-toolbox-muted font-mono w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused",
      }) as VNode;
    case "spinner":
      return h("div", {
        class: "flex items-center justify-center py-6",
        "data-toolbox-spinner": "",
        children: h("span", {
          class:
            "inline-block w-5 h-5 border-2 border-toolbox-accent border-t-transparent rounded-full animate-spin",
        }),
      }) as VNode;
  }
}

function childToPreact(
  child: ChildNode,
  windowStates: ReadonlyMap<string, WindowState>,
  activeWindowId: string | null,
  onFocusWindow: (id: string) => void,
  onMoveWindow: (id: string, x: number, y: number) => void,
): VNode {
  if (child.kind === "window") {
    return windowToPreact(child, windowStates, activeWindowId, onFocusWindow, onMoveWindow);
  }
  return nodeToPreact(child, windowStates, activeWindowId, onFocusWindow, onMoveWindow);
}

function windowToPreact(
  w: WindowNode,
  windowStates: ReadonlyMap<string, WindowState>,
  activeWindowId: string | null,
  onFocusWindow: (id: string) => void,
  onMoveWindow: (id: string, x: number, y: number) => void,
): VNode {
  const state = windowStates.get(w.id) ?? { x: 0, y: 0, zIndex: 0 };
  const isActive = w.id === activeWindowId;

  const handleTitleBarPointerDown = (e: PointerEvent) => {
    onFocusWindow(w.id);
    const titleBar = e.currentTarget as HTMLElement;
    const container = titleBar.parentElement;
    if (!container) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = state.x;
    const startTop = state.y;

    const onPointerMove = (moveEvent: PointerEvent) => {
      container.style.left = `${startLeft + moveEvent.clientX - startX}px`;
      container.style.top = `${startTop + moveEvent.clientY - startY}px`;
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      const finalX = startLeft + upEvent.clientX - startX;
      const finalY = startTop + upEvent.clientY - startY;
      onMoveWindow(w.id, finalX, finalY);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const titleBarChildren: VNode[] = [];
  titleBarChildren.push(
    h("span", { class: "flex-1 text-xs text-toolbox-muted truncate" }, w.title || w.id) as VNode,
  );
  if (w.onClose) {
    titleBarChildren.push(
      h(
        "button",
        {
          class: "text-toolbox-muted hover:text-toolbox-accent-yellow text-sm leading-none px-1",
          onClick: w.onClose,
        },
        "\u00D7",
      ) as VNode,
    );
  }

  const containerClass = `fixed min-w-72 flex flex-col rounded-lg overflow-hidden${isActive ? " ring-1 ring-focused" : ""}`;

  const titleBar = h("div", {
    class:
      "flex items-center h-9 bg-toolbox-deepest border-b border-toolbox-border px-3 cursor-default select-none",
    onPointerDown: handleTitleBarPointerDown,
    children: titleBarChildren,
  });

  const body = h("div", {
    class: "flex-1 bg-toolbox-surface p-3 flex flex-col gap-1 min-h-0",
    children: w.children.map((child) =>
      childToPreact(child, windowStates, activeWindowId, onFocusWindow, onMoveWindow),
    ),
  });

  return h("div", {
    class: containerClass,
    style: { left: state.x, top: state.y, zIndex: state.zIndex } as any,
    "data-toolbox-window": w.id,
    onPointerDown: () => onFocusWindow(w.id),
    children: [titleBar, body],
  }) as VNode;
}

export function toPreact(
  windows: WindowNode[],
  windowStates: ReadonlyMap<string, WindowState>,
  activeWindowId: string | null,
  onFocusWindow: (id: string) => void,
  onMoveWindow: (id: string, x: number, y: number) => void,
): VNode {
  return h("div", {
    class: "fixed inset-0",
    children: windows.map((w) =>
      windowToPreact(w, windowStates, activeWindowId, onFocusWindow, onMoveWindow),
    ),
  }) as VNode;
}
