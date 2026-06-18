import { h, type VNode } from "preact";
import type { ChildNode, Node, WindowNode } from "./collector.ts";
import type { WindowState } from "./runtime.ts";
import { filesFromClipboardItems, filesFromDataTransfer } from "./file-intake.ts";

/**
 * Bundles the four window-chrome concerns that window rendering needs.
 * Pure node rendering (labels, buttons, inputs, etc.) does not receive this context.
 */
export interface RenderContext {
  windowStates: ReadonlyMap<string, WindowState>;
  activeWindowId: string | null;
  onFocusWindow: (id: string) => void;
  onMoveWindow: (id: string, x: number, y: number) => void;
}

/**
 * Pure node renderer: converts a single leaf/row Node to a VNode.
 * Has no dependency on window-chrome concerns.
 * The `renderChild` callback handles nested children (e.g. inside `row`),
 * so the caller controls how child ChildNodes are resolved.
 */
export function renderNode(node: Node, renderChild: (child: ChildNode) => VNode): VNode {
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
        ...node.children.map((child) => renderChild(child)),
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
    case "file":
      return fileToPreact(node);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Read the clipboard via the async Clipboard API (the `…` menu path, for touch
// and no-keyboard use). Silently ignores denial / lack of support.
async function pasteFromClipboard(node: Extract<Node, { kind: "file" }>): Promise<void> {
  try {
    const clip = navigator.clipboard;
    if (!clip?.read) return;
    const files = await filesFromClipboardItems(await clip.read());
    if (files.length > 0) node.resolve(files);
  } catch {
    // permission denied or unsupported — no-op
  }
}

function fileBox(el: HTMLElement): Element | null {
  return el.closest("[data-toolbox-file]");
}

function clickHiddenInput(el: HTMLElement): void {
  fileBox(el)?.querySelector<HTMLInputElement>('input[type="file"]')?.click();
}

function closeMenu(el: HTMLElement): void {
  const details = el.closest("details");
  if (details) (details as HTMLDetailsElement).open = false;
}

function fileToPreact(node: Extract<Node, { kind: "file" }>): VNode {
  const f = node.file;

  const body: VNode = f
    ? (h("div", { class: "flex flex-col gap-1" }, [
        h("div", { class: "flex items-center gap-2" }, [
          h("span", { class: "text-toolbox-accent" }, "📄"),
          h("span", { class: "flex-1 truncate text-toolbox-text" }, f.name),
        ]),
        h(
          "div",
          { class: "text-xs text-toolbox-muted" },
          `${f.type || "application/octet-stream"} · ${formatBytes(f.size)}`,
        ),
      ]) as VNode)
    : (h(
        "span",
        { class: "text-toolbox-muted text-sm" },
        node.label ?? "Click and paste, drop a file, or use the ⋯ menu",
      ) as VNode);

  const hiddenInput = h("input", {
    type: "file",
    accept: node.accept,
    class: "hidden",
    onChange: (e: Event) => {
      const input = e.currentTarget as HTMLInputElement;
      node.resolve(Array.from(input.files ?? []));
      input.value = "";
    },
  });

  const menuItemClass =
    "text-left px-3 py-1.5 text-sm text-toolbox-text hover:bg-toolbox-content whitespace-nowrap";
  const menu = h(
    "details",
    {
      class: "relative shrink-0 opacity-60 hover:opacity-100",
      onClick: (e: Event) => e.stopPropagation(),
    },
    [
      h(
        "summary",
        {
          class:
            "list-none cursor-pointer px-1 text-toolbox-muted hover:text-toolbox-text select-none",
          "aria-label": "File options",
        },
        "⋯",
      ),
      h(
        "div",
        {
          class:
            "absolute right-0 mt-1 z-10 min-w-44 bg-toolbox-surface border border-toolbox-border rounded shadow-xl flex flex-col py-1",
        },
        [
          h(
            "button",
            {
              type: "button",
              class: menuItemClass,
              onClick: (e: Event) => {
                closeMenu(e.currentTarget as HTMLElement);
                clickHiddenInput(e.currentTarget as HTMLElement);
              },
            },
            "Choose file…",
          ),
          h(
            "button",
            {
              type: "button",
              class: menuItemClass,
              onClick: (e: Event) => {
                closeMenu(e.currentTarget as HTMLElement);
                void pasteFromClipboard(node);
              },
            },
            "Paste from clipboard",
          ),
        ],
      ),
    ],
  );

  const setDragActive = (e: Event, active: boolean) => {
    const box = e.currentTarget as HTMLElement;
    box.classList.toggle("ring-2", active);
    box.classList.toggle("ring-focused", active);
  };

  return h("div", {
    tabindex: 0,
    "data-toolbox-file": "",
    class:
      "border border-dashed border-toolbox-border rounded px-3 py-4 bg-toolbox-deepest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused",
    onPaste: (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const files = filesFromDataTransfer(e.clipboardData);
      if (files.length > 0) {
        e.preventDefault();
        node.resolve(files);
      }
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragActive(e, true);
    },
    onDragLeave: (e: DragEvent) => setDragActive(e, false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragActive(e, false);
      if (e.dataTransfer) node.resolve(filesFromDataTransfer(e.dataTransfer));
    },
    children: [
      h("div", { class: "flex items-start gap-2" }, [
        h("div", { class: "flex-1 min-w-0" }, body),
        menu,
      ]),
      hiddenInput,
    ],
  }) as VNode;
}

function childToPreact(child: ChildNode, ctx: RenderContext): VNode {
  if (child.kind === "window") {
    return windowToPreact(child, ctx);
  }
  return renderNode(child, (c) => childToPreact(c, ctx));
}

function windowToPreact(w: WindowNode, ctx: RenderContext): VNode {
  const { windowStates, activeWindowId, onFocusWindow, onMoveWindow } = ctx;
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
        "×",
      ) as VNode,
    );
  }

  const containerClass = `fixed min-w-72 flex flex-col rounded-lg overflow-hidden ${isActive ? "ring-1 ring-focused" : ""}`;

  const titleBar = h("div", {
    class:
      "flex items-center h-9 bg-toolbox-deepest border-b border-toolbox-border px-3 cursor-default select-none",
    onPointerDown: handleTitleBarPointerDown,
    children: titleBarChildren,
  });

  const body = h("div", {
    class: "flex-1 bg-toolbox-surface p-3 flex flex-col gap-1 min-h-0",
    children: w.children.map((child) => childToPreact(child, ctx)),
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
  const ctx: RenderContext = { windowStates, activeWindowId, onFocusWindow, onMoveWindow };
  return h("div", {
    class: "fixed inset-0",
    children: windows.map((w) => windowToPreact(w, ctx)),
  }) as VNode;
}
