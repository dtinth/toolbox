import { h, render, type VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
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

// Open the native file chooser via an ephemeral input (no hidden input lives in
// the box, so nothing depends on DOM traversal from the portaled menu).
function openFileDialog(node: Extract<Node, { kind: "file" }>): void {
  const input = document.createElement("input");
  input.type = "file";
  if (node.accept) input.accept = node.accept;
  input.addEventListener("change", () => {
    node.resolve(Array.from(input.files ?? []));
  });
  input.click();
}

// Save the current file to disk.
function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Open the file (blob URL) in a new tab — doubles as a preview.
function openInNewTab(file: File): void {
  const url = URL.createObjectURL(file);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Only text and PNG can be put on the clipboard (browser-supported types).
function canCopyToClipboard(file: File): boolean {
  return file.type === "text/plain" || file.type === "image/png";
}
async function copyFileToClipboard(file: File): Promise<void> {
  try {
    if (file.type === "text/plain") {
      await navigator.clipboard.writeText(await file.text());
    } else if (file.type === "image/png") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": file })]);
    }
  } catch {
    // permission denied / unsupported — no-op
  }
}

// Drag the file out of the browser onto the OS desktop using the Chromium
// "DownloadURL" DataTransfer trick (https://dt.in.th/DownloadURL). Module-
// scoped because the runtime re-renders often: dragstart and dragend must
// share the same object-URL across re-renders during a single drag.
let dragOutUrl: string | null = null;
function startFileDragOut(e: DragEvent, file: File): void {
  if (!e.dataTransfer) return;
  dragOutUrl = URL.createObjectURL(file);
  const mime = file.type || "application/octet-stream";
  e.dataTransfer.setData("DownloadURL", `${mime}:${file.name}:${dragOutUrl}`);
  e.dataTransfer.effectAllowed = "copy";
}
function endFileDragOut(): void {
  const url = dragOutUrl;
  dragOutUrl = null;
  // Revoke late: the OS may still be reading the URL to write the file.
  if (url) setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// The `…` menu. Anchored to the ⋯ button but rendered into a detached host on
// document.body and positioned with floating-ui, so it floats over (and past)
// the clipped window — windows keep their overflow-hidden; popovers escape,
// like other host chrome. Rendering the popover and wiring its position happen
// in one effect so the element always exists before it is positioned.
function FileMenu({ node }: { node: Extract<Node, { kind: "file" }> }): VNode {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  // The runtime re-renders every frame, so `node` is a fresh object each frame.
  // Keep it in a ref and depend the effect only on `open`, otherwise the menu
  // host would be torn down + rebuilt every frame, breaking real (multi-frame)
  // clicks. Handlers read nodeRef.current so they act on the latest node.
  const nodeRef = useRef(node);
  nodeRef.current = node;

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) return;

    const host = document.createElement("div");
    host.setAttribute("data-toolbox-chrome", "");
    document.body.appendChild(host);

    const run = (fn: () => void) => () => {
      setOpen(false);
      fn();
    };
    const withFile = (fn: (file: File) => void) => () => {
      const file = nodeRef.current.file;
      if (file) fn(file);
    };
    const itemClass =
      "text-left px-3 py-1.5 text-sm text-toolbox-text hover:bg-toolbox-content whitespace-nowrap";
    const item = (label: string, onClick: () => void): VNode =>
      h("button", { type: "button", class: itemClass, onClick }, label) as VNode;
    const menuItems: VNode[] = [];
    if (!nodeRef.current.readOnly) {
      menuItems.push(
        item(
          "Choose file…",
          run(() => openFileDialog(nodeRef.current)),
        ),
      );
      menuItems.push(
        item(
          "Paste from clipboard",
          run(() => void pasteFromClipboard(nodeRef.current)),
        ),
      );
    }
    if (nodeRef.current.file) {
      menuItems.push(item("Open in new tab", run(withFile(openInNewTab))));
      if (canCopyToClipboard(nodeRef.current.file)) {
        menuItems.push(
          item("Copy to clipboard", run(withFile((f) => void copyFileToClipboard(f)))),
        );
      }
      menuItems.push(item("Download", run(withFile(downloadFile))));
    }
    render(
      h(
        "div",
        {
          class:
            "fixed left-0 top-0 z-50 min-w-44 bg-toolbox-surface border border-toolbox-border rounded shadow-xl flex flex-col py-1",
          onClick: (e: Event) => e.stopPropagation(),
        },
        menuItems,
      ),
      host,
    );

    const pop = host.firstElementChild as HTMLElement;
    const stop = autoUpdate(
      anchor,
      pop,
      () => {
        void computePosition(anchor, pop, {
          placement: "bottom-end",
          middleware: [offset(4), flip(), shift({ padding: 8 })],
        }).then(({ x, y }) => {
          pop.style.left = `${x}px`;
          pop.style.top = `${y}px`;
        });
      },
      { animationFrame: true },
    );

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as globalThis.Node;
      if (!host.contains(target) && !anchor.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);

    return () => {
      stop();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      render(null, host);
      host.remove();
    };
  }, [open]);

  // A read-only box with no file has no actions — render no menu.
  if (node.readOnly && !node.file) return null as unknown as VNode;

  return h(
    "button",
    {
      ref: anchorRef,
      type: "button",
      "aria-label": "File options",
      class:
        "shrink-0 px-1 text-toolbox-muted hover:text-toolbox-text select-none opacity-60 hover:opacity-100",
      onClick: (e: Event) => {
        e.stopPropagation();
        setOpen((o) => !o);
      },
    },
    "⋯",
  ) as VNode;
}

function fileToPreact(node: Extract<Node, { kind: "file" }>): VNode {
  const f = node.file;
  const readOnly = node.readOnly === true;

  const body: VNode = f
    ? (h("div", { class: "flex flex-col gap-1" }, [
        h("div", { class: "flex items-center gap-2" }, [
          // Draggable icon: drag the file out to the OS (Chromium DownloadURL).
          h(
            "span",
            {
              class: "text-toolbox-accent cursor-grab active:cursor-grabbing",
              draggable: true,
              title: "Drag to save this file",
              onDragStart: (e: DragEvent) => startFileDragOut(e, f),
              onDragEnd: endFileDragOut,
            },
            "📄",
          ),
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
        node.label ??
          (readOnly ? "No file yet" : "Click and paste, drop a file, or use the ⋯ menu"),
      ) as VNode);

  const setDragActive = (e: Event, active: boolean) => {
    const box = e.currentTarget as HTMLElement;
    box.classList.toggle("ring-2", active);
    box.classList.toggle("ring-focused", active);
  };

  // Read-only / output box: display + export only, no drop / paste / focus intake.
  const intake = readOnly
    ? {}
    : {
        tabindex: 0,
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
      };

  return h("div", {
    "data-toolbox-file": "",
    class: `border ${readOnly ? "border-solid" : "border-dashed"} border-toolbox-border rounded px-3 py-4 bg-toolbox-deepest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused`,
    ...intake,
    children: [
      h("div", { class: "flex items-start gap-2" }, [
        h("div", { class: "flex-1 min-w-0" }, body),
        h(FileMenu, { node }),
      ]),
    ],
  }) as VNode;
}

function childToPreact(child: ChildNode, ctx: RenderContext): VNode {
  if (child.kind === "window") {
    return h(Window, { w: child, ctx, key: child.id }) as VNode;
  }
  return renderNode(child, (c) => childToPreact(c, ctx));
}

interface WindowDrag {
  containerRef: { current: HTMLDivElement | null };
  onTitlePointerDown: (e: PointerEvent) => void;
}

// Title-bar drag. Mutates the container element directly during the drag (no
// per-move re-render / collector re-run) and commits the final position on
// pointerup. The global listeners self-remove on pointerup; the unmount cleanup
// covers a window that closes mid-drag.
function useWindowDrag(w: WindowNode, ctx: RenderContext): WindowDrag {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const onTitlePointerDown = (e: PointerEvent) => {
    ctx.onFocusWindow(w.id);
    const container = containerRef.current;
    if (!container) return;
    const state = ctx.windowStates.get(w.id) ?? { x: 0, y: 0, zIndex: 0 };
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = state.x;
    const startTop = state.y;

    const onPointerMove = (ev: PointerEvent) => {
      container.style.left = `${startLeft + ev.clientX - startX}px`;
      container.style.top = `${startTop + ev.clientY - startY}px`;
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      cleanupRef.current = null;
    };
    const onPointerUp = (ev: PointerEvent) => {
      cleanup();
      ctx.onMoveWindow(w.id, startLeft + ev.clientX - startX, startTop + ev.clientY - startY);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    cleanupRef.current = cleanup;
  };

  return { containerRef, onTitlePointerDown };
}

// A floating window. The interaction (drag/focus, and later resize/pop-out)
// lives here as a component so it has a real lifecycle + a container ref; the
// pure markup is built by windowToPreact (kept separate and unit-testable).
function Window({ w, ctx }: { w: WindowNode; ctx: RenderContext }): VNode {
  const drag = useWindowDrag(w, ctx);
  return windowToPreact(w, ctx, drag);
}

export function windowToPreact(w: WindowNode, ctx: RenderContext, drag: WindowDrag): VNode {
  const { windowStates, activeWindowId, onFocusWindow } = ctx;
  const state = windowStates.get(w.id) ?? { x: 0, y: 0, zIndex: 0 };
  const isActive = w.id === activeWindowId;

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
    onPointerDown: drag.onTitlePointerDown,
    children: titleBarChildren,
  });

  const body = h("div", {
    class: "flex-1 bg-toolbox-surface p-3 flex flex-col gap-1 min-h-0",
    children: w.children.map((child) => childToPreact(child, ctx)),
  });

  return h("div", {
    ref: drag.containerRef,
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
    children: windows.map((w) => h(Window, { w, ctx, key: w.id })),
  }) as VNode;
}
