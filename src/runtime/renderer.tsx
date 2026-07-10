// oxlint-disable-next-line import/consistent-type-specifier-style -- a lone `import type` from "preact" trips no-duplicate-imports against the value import
import { Fragment, h, render, type VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { type ChildNode, type MenuNode, type Node, type WindowNode } from "./collector.ts";
import { type WindowState } from "./runtime.ts";
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
    case "label": {
      return h("div", null, node.text) as VNode;
    }
    case "button": {
      return h(
        "button",
        {
          class:
            "bg-toolbox-content border border-toolbox-border-light rounded px-3 py-1.5 text-sm text-toolbox-text hover:bg-[#454443] active:bg-toolbox-deepest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused",
          onClick: node.onClick,
        },
        node.label,
      ) as VNode;
    }
    case "row": {
      return h(
        "div",
        { class: "flex flex-row items-center gap-2" },
        ...mapChildren(node.children, renderChild),
      ) as VNode;
    }
    case "textInput": {
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
    }
    case "textarea": {
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
    }
    case "checkbox": {
      return h(
        "label",
        {
          class: `flex flex-row items-center gap-2 select-none text-toolbox-text text-sm ${
            node.disabled === true ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          }`,
        },
        h("input", {
          type: "checkbox",
          checked: node.checked,
          disabled: node.disabled,
          class: "accent-toolbox-accent",
          onChange: (e: Event) => {
            const checked = (e.currentTarget as HTMLInputElement).checked;
            node.onChange?.(checked);
          },
        }),
        h("span", null, node.label),
      ) as VNode;
    }
    case "segmented": {
      return h(
        "div",
        {
          role: "radiogroup",
          class:
            "inline-flex flex-row gap-1 p-1 rounded-md bg-toolbox-deepest border border-toolbox-border",
        },
        ...node.options.map((opt) => {
          const selected = opt.value === node.value;
          return h(
            "button",
            {
              type: "button",
              role: "radio",
              "aria-checked": selected ? "true" : "false",
              class: `px-3 py-1 text-sm rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused ${
                selected
                  ? "bg-toolbox-accent text-toolbox-deepest font-medium"
                  : "text-toolbox-text hover:bg-toolbox-content"
              }`,
              onClick: () => {
                if (!selected) {
                  node.onChange?.(opt.value);
                }
              },
            },
            opt.label,
          );
        }),
      ) as VNode;
    }
    case "spinner": {
      return h("div", {
        class: "flex items-center justify-center py-6",
        "data-toolbox-spinner": "",
        children: h("span", {
          class:
            "inline-block w-5 h-5 border-2 border-toolbox-accent border-t-transparent rounded-full animate-spin",
        }),
      }) as VNode;
    }
    case "file": {
      return fileToPreact(node);
    }
    case "copyableText": {
      return h(CopyableText, { node }) as VNode;
    }
    case "custom": {
      return h(CustomWidget, { render: node.render }) as VNode;
    }
    case "identityGroup": {
      // A collector marker, stripped by mapChildren before it ever reaches here;
      // present only for switch exhaustiveness.
      throw new Error("identityGroup is a collector marker, not a renderable node");
    }
  }
  // Unreachable: node.kind is exhaustively handled above.
  throw new Error(`Unhandled node kind: ${(node as { kind: string }).kind}`);
}

// A Custom widget (ADR-0007): a stable component wrapper so the tool's live
// Preact subtree — its signal subscriptions and any internal hook state —
// survives redraws as long as its (group, position) key is stable. Reading a
// signal inside render() auto-subscribes this component (@preact/signals), so a
// signal write repaints just this widget, without re-running onRender.
function CustomWidget({ render: renderWidget }: { render: () => unknown }): VNode {
  return renderWidget() as VNode;
}

/**
 * Map a container's children to keyed VNodes. A node's identity is
 * `(group, position)`: an `identityGroup` marker resets the position cursor (and
 * takes the next ordinal group when anonymous), so a stable region keeps its keys
 * — and any custom widget's mount — across redraws even as a variable region
 * above it changes shape.
 */
function mapChildren(children: ChildNode[], renderOne: (child: ChildNode) => VNode): VNode[] {
  let group = "1";
  let pos = 0;
  let anon = 1;
  const out: VNode[] = [];
  for (const child of children) {
    if (child.kind === "identityGroup") {
      group = child.group ?? String(++anon);
      pos = 0;
      continue;
    }
    const vnode = renderOne(child);
    vnode.key = `${group}:${pos}`;
    pos++;
    out.push(vnode);
  }
  return out;
}

function CopyableText({ node }: { node: Extract<Node, { kind: "copyableText" }> }): VNode {
  const [copied, setCopied] = useState(false);
  const textRef = useRef(node.text);
  textRef.current = node.text;

  return h(
    "div",
    {
      draggable: true,
      title: "Click to copy · drag to export",
      class:
        "border border-toolbox-border rounded px-3 py-2 bg-toolbox-deepest flex items-center gap-2 cursor-pointer select-none",
      onClick: () => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(textRef.current);
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1200);
          } catch {
            // clipboard write denied / unsupported — no-op
          }
        })();
      },
      onDragStart: (e: DragEvent) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData("text/plain", textRef.current);
          e.dataTransfer.effectAllowed = "copy";
        }
      },
    },
    h("span", { class: "flex-1 min-w-0 truncate font-mono text-sm text-toolbox-text" }, node.text),
    h("span", { class: "text-xs text-toolbox-muted shrink-0" }, copied ? "Copied" : "⧉"),
  ) as VNode;
}

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Read the clipboard via the async Clipboard API (the `…` menu path, for touch
// and no-keyboard use). Silently ignores denial / lack of support.
async function pasteFromClipboard(node: Extract<Node, { kind: "file" }>): Promise<void> {
  try {
    const clip = navigator.clipboard;
    if (typeof clip?.read !== "function") {
      return;
    }
    const files = await filesFromClipboardItems(await clip.read());
    if (files.length > 0) {
      node.resolve(files);
    }
  } catch {
    // permission denied or unsupported — no-op
  }
}

// Open the native file chooser via an ephemeral input (no hidden input lives in
// the box, so nothing depends on DOM traversal from the portaled menu).
function openFileDialog(node: Extract<Node, { kind: "file" }>): void {
  const input = document.createElement("input");
  input.type = "file";
  if (node.accept !== undefined && node.accept !== "") {
    input.accept = node.accept;
  }
  input.addEventListener("change", () => {
    node.resolve([...(input.files ?? [])]);
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
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

// Open the file (blob URL) in a new tab — doubles as a preview.
function openInNewTab(file: File): void {
  const url = URL.createObjectURL(file);
  window.open(url, "_blank", "noopener");
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

// Any text/* type can be copied as text; PNG as an image (browser-supported
// types). Other binaries have no clipboard representation.
function canCopyToClipboard(file: File): boolean {
  return file.type.startsWith("text/") || file.type === "image/png";
}
async function copyFileToClipboard(file: File): Promise<void> {
  try {
    if (file.type.startsWith("text/")) {
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
//
// `DownloadURL` is an OS-only channel — the browser never turns it back into a
// File for an in-app drop. So the same drag also publishes the original File on
// this module-level channel, so dropping the box into another ui.file widget
// delivers the identical bytes (no round-trip through the blob URL). The File is
// set on dragstart and cleared on dragend, so any drop happening while it is set
// is one of ours — that's the signal the receiving handler trusts (drop precedes
// dragend). We deliberately don't tag the DataTransfer with a custom marker MIME:
// WebKit (every browser on iPad) strips non-standard types from `dataTransfer`,
// so a marker would vanish on drop and the in-app drag would look like nothing.
//
// A text/* file additionally publishes its contents as `text/plain`, so the box
// can be dragged straight into any text field (a textarea, another app, an
// editor) — the same affordance CopyableText offers. `dragstart` can't await
// `file.text()`, so the contents are pre-read into `textContentCache` while the
// box renders and read back synchronously here.
let dragOutUrl: string | null = null;
let activeDragFile: File | null = null;
const textContentCache = new WeakMap<File, string>();
// Pre-read a text/* file's contents so a drag-out can set `text/plain`
// synchronously. Keyed by File so the per-frame re-render reads each file once.
function warmTextContent(file: File): void {
  if (!file.type.startsWith("text/") || textContentCache.has(file)) {
    return;
  }
  void (async () => {
    try {
      const t = await file.text();
      textContentCache.set(file, t);
    } catch {
      // read failed — leave uncached
    }
  })();
}
function startFileDragOut(e: DragEvent, file: File): void {
  if (!e.dataTransfer) {
    return;
  }
  dragOutUrl = URL.createObjectURL(file);
  activeDragFile = file;
  const mime = file.type || "application/octet-stream";
  e.dataTransfer.setData("DownloadURL", `${mime}:${file.name}:${dragOutUrl}`);
  const text = textContentCache.get(file);
  if (text !== undefined) {
    e.dataTransfer.setData("text/plain", text);
  }
  e.dataTransfer.effectAllowed = "copy";
}
function endFileDragOut(): void {
  const url = dragOutUrl;
  dragOutUrl = null;
  activeDragFile = null;
  // Revoke late: the OS may still be reading the URL to write the file.
  if (url !== null && url !== "") {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
  }
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
    if (!open || !anchor) {
      return undefined;
    }

    const host = document.createElement("div");
    host.dataset.toolboxChrome = "";
    document.body.append(host);

    const run = (fn: () => void) => () => {
      setOpen(false);
      fn();
    };
    const withFile = (fn: (file: File) => void) => () => {
      const file = nodeRef.current.file;
      if (file) {
        fn(file);
      }
    };
    const itemClass =
      "text-left px-3 py-1.5 text-sm text-toolbox-text hover:bg-toolbox-content whitespace-nowrap";
    const item = (label: string, onClick: () => void): VNode =>
      h("button", { type: "button", class: itemClass, onClick }, label) as VNode;
    const separator = (): VNode =>
      h("div", { class: "my-1 border-t border-toolbox-border" }) as VNode;

    // Items fall into groups — bringing a file IN, taking the current file OUT,
    // and clearing it — kept visually distinct with separators (like the Age
    // identity menu). Empty groups drop out so no stray separators appear.
    const intake: VNode[] = [];
    if (nodeRef.current.readOnly !== true) {
      intake.push(
        item(
          "Choose file…",
          run(() => {
            openFileDialog(nodeRef.current);
          }),
        ),
        item(
          "Paste from clipboard",
          run(() => void pasteFromClipboard(nodeRef.current)),
        ),
      );
    }
    const exportItems: VNode[] = [];
    if (nodeRef.current.file) {
      exportItems.push(item("Open in new tab", run(withFile(openInNewTab))));
      if (canCopyToClipboard(nodeRef.current.file)) {
        exportItems.push(
          item("Copy to clipboard", run(withFile((f) => void copyFileToClipboard(f)))),
        );
      }
      exportItems.push(item("Download", run(withFile(downloadFile))));
    }
    const clearItems: VNode[] = [];
    if (nodeRef.current.readOnly !== true && nodeRef.current.file && nodeRef.current.clear) {
      clearItems.push(
        item(
          "Clear",
          run(() => nodeRef.current.clear?.()),
        ),
      );
    }

    const groups = [intake, exportItems, clearItems].filter((g) => g.length > 0);
    const menuItems: VNode[] = [];
    groups.forEach((group, i) => {
      if (i > 0) {
        menuItems.push(separator());
      }
      menuItems.push(...group);
    });
    render(
      h(
        "div",
        {
          class:
            "fixed left-0 top-0 z-50 min-w-44 bg-toolbox-surface border border-toolbox-border rounded shadow-xl flex flex-col py-1",
          onClick: (e: Event) => {
            e.stopPropagation();
          },
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
        void (async () => {
          const { x, y } = await computePosition(anchor, pop, {
            placement: "bottom-end",
            middleware: [offset(4), flip(), shift({ padding: 8 })],
          });
          pop.style.left = `${x}px`;
          pop.style.top = `${y}px`;
        })();
      },
      { animationFrame: true },
    );

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as globalThis.Node;
      if (!host.contains(target) && !anchor.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
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
  if (node.readOnly === true && !node.file) {
    return null as unknown as VNode;
  }

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

// Toggle the drag-hover ring on the file box (module-scoped: captures nothing).
function setDragActive(e: Event, active: boolean): void {
  const box = e.currentTarget as HTMLElement;
  box.classList.toggle("ring-2", active);
  box.classList.toggle("ring-focused", active);
}

function fileToPreact(node: Extract<Node, { kind: "file" }>): VNode {
  const f = node.file;
  const readOnly = node.readOnly === true;
  // Pre-read text contents so a drag-out can publish them as `text/plain`.
  if (f) {
    warmTextContent(f);
  }

  const body: VNode = f
    ? (h("div", { class: "flex flex-col gap-1" }, [
        h("div", { class: "flex items-center gap-2" }, [
          // The whole box is the drag-out handle (see below) — the icon is just a
          // cue, so there is no tiny target to miss / text-select on touch.
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
        node.label ??
          (readOnly ? "No file yet" : "Click and paste, drop a file, or use the ⋯ menu"),
      ) as VNode);

  // Read-only / output box: display + export only, no drop / paste / focus intake.
  const intake = readOnly
    ? {}
    : {
        tabindex: 0,
        onPaste: (e: ClipboardEvent) => {
          if (!e.clipboardData) {
            return;
          }
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
        onDragLeave: (e: DragEvent) => {
          setDragActive(e, false);
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setDragActive(e, false);
          const dt = e.dataTransfer;
          if (!dt) {
            return;
          }
          // An in-app box drag is in flight exactly when `activeDragFile` is set
          // (set on dragstart, cleared on dragend; the drop precedes dragend), so
          // it's the authoritative source — deliver its identical bytes and name.
          // A text/* box drag also carries `text/plain`, which would otherwise be
          // turned into a synthesized text file and lose the original name/type.
          // Only a foreign drag (OS file, text from another app) falls through to
          // the DataTransfer payload.
          if (activeDragFile) {
            node.resolve([activeDragFile]);
            return;
          }
          node.resolve(filesFromDataTransfer(dt));
        },
      };

  // Drag the whole box out (to the OS via Chromium DownloadURL, or to another
  // ui.file in-app) when a file is present — a big, touch-friendly handle, and
  // select-none stops iPad from text-selecting the icon/name instead of dragging.
  const dragOut = f
    ? {
        draggable: true,
        title: "Drag this file out",
        onDragStart: (e: DragEvent) => {
          startFileDragOut(e, f);
        },
        onDragEnd: endFileDragOut,
      }
    : {};

  return h("div", {
    "data-toolbox-file": "",
    class: `border ${readOnly ? "border-solid" : "border-dashed"} border-toolbox-border rounded px-3 py-4 bg-toolbox-deepest select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focused${f ? " cursor-grab active:cursor-grabbing" : ""}`,
    ...intake,
    ...dragOut,
    children: [
      h("div", { class: "flex items-start gap-2" }, [
        h("div", { class: "flex-1 min-w-0" }, body),
        h(FileMenu, { node }),
      ]),
    ],
  }) as VNode;
}

function MenuBarItem({ menu }: { menu: MenuNode }): VNode {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  // Keep the latest menu in a ref so that the effect (keyed only on `open`) reads
  // fresh items without tearing the dropdown down on every re-render.
  const menuRef = useRef(menu);
  menuRef.current = menu;

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) {
      return undefined;
    }

    const host = document.createElement("div");
    host.dataset.toolboxChrome = "";
    document.body.append(host);

    const renderDropdown = () => {
      const items = menuRef.current.items.map((item) => {
        if (item.kind === "menuSeparator") {
          return h("div", { class: "my-1 border-t border-toolbox-border" }) as VNode;
        }
        return h(
          "button",
          {
            type: "button",
            class:
              "text-left px-3 py-1.5 text-sm text-toolbox-text hover:bg-toolbox-content whitespace-nowrap",
            onClick: () => {
              setOpen(false);
              item.onClick?.();
            },
          },
          item.label,
        ) as VNode;
      });
      render(
        h(
          "div",
          {
            class:
              "fixed left-0 top-0 z-50 min-w-44 bg-toolbox-surface border border-toolbox-border rounded shadow-xl flex flex-col py-1",
            onClick: (e: Event) => {
              e.stopPropagation();
            },
          },
          items,
        ),
        host,
      );
    };

    renderDropdown();

    const pop = host.firstElementChild as HTMLElement;
    const stop = autoUpdate(
      anchor,
      pop,
      () => {
        void (async () => {
          const { x, y } = await computePosition(anchor, pop, {
            placement: "bottom-start",
            middleware: [offset(4), flip(), shift({ padding: 8 })],
          });
          pop.style.left = `${x}px`;
          pop.style.top = `${y}px`;
        })();
      },
      { animationFrame: true },
    );

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as globalThis.Node;
      if (!host.contains(target) && !anchor.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
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

  return h(
    "button",
    {
      ref: anchorRef,
      type: "button",
      class: "px-2 py-0.5 text-xs text-toolbox-text rounded hover:bg-toolbox-content",
      onClick: () => {
        setOpen((o) => !o);
      },
    },
    menu.label,
  ) as VNode;
}

function WindowMenuBar({ menus }: { menus: MenuNode[] }): VNode {
  return h(
    "div",
    {
      class:
        "flex items-center gap-1 px-2 h-8 bg-toolbox-deepest border-b border-toolbox-border select-none",
    },
    menus.map((menu) => h(MenuBarItem, { menu, key: menu.label })),
  ) as VNode;
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

// Title-bar drag. During the drag the window is moved with a compositor-only
// `transform` (no per-frame layout / collector re-run, and re-renders never
// clobber it because `transform` isn't part of the vnode style). On release the
// offset is baked into `left`/`top` atomically — so a static (non-ticking) tool
// that never re-renders doesn't snap back.
//
// Tracking is done with `window` listeners rather than `setPointerCapture`:
// explicit capture interacts badly with touch (a fast flick makes the browser
// fire `pointercancel`, which would abort the drag the moment the finger moves
// off the handle). The pointer is implicitly captured by the handle for touch,
// and `window` sees every in-viewport move regardless, so the window follows the
// cursor/finger anywhere. `touch-action: none` on the handle keeps the browser
// from claiming the gesture for scrolling, and `user-select: none` on the root
// (plus preventDefault) suppresses the body text-selection that, repainted over
// the re-rendering DOM, is the other source of jank. The listeners self-remove
// on release; the unmount cleanup covers a window that closes mid-drag.
function useWindowDrag(w: WindowNode, ctx: RenderContext): WindowDrag {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const onTitlePointerDown = (e: PointerEvent) => {
    // Primary button / touch / pen only; let title-bar controls (e.g. the ×
    // close button) handle their own clicks instead of starting a drag.
    if (e.button !== 0) {
      return;
    }
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }

    e.preventDefault();
    ctx.onFocusWindow(w.id);
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const state = ctx.windowStates.get(w.id) ?? { x: 0, y: 0, zIndex: 0 };
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = state.x;
    const startTop = state.y;
    let dx = 0;
    let dy = 0;

    const prevUserSelect = document.documentElement.style.userSelect;
    document.documentElement.style.userSelect = "none";

    const onPointerMove = (ev: PointerEvent) => {
      dx = ev.clientX - startX;
      dy = ev.clientY - startY;
      container.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const cleanup = () => {
      globalThis.removeEventListener("pointermove", onPointerMove);
      globalThis.removeEventListener("pointerup", onPointerUp);
      globalThis.removeEventListener("pointercancel", onPointerUp);
      document.documentElement.style.userSelect = prevUserSelect;
      cleanupRef.current = null;
    };
    const onPointerUp = () => {
      cleanup();
      // Bake the transform offset into left/top in one shot, then commit to the
      // window manager so future re-renders agree with the DOM.
      const finalLeft = startLeft + dx;
      const finalTop = startTop + dy;
      container.style.transform = "";
      container.style.left = `${finalLeft}px`;
      container.style.top = `${finalTop}px`;
      ctx.onMoveWindow(w.id, finalLeft, finalTop);
    };

    globalThis.addEventListener("pointermove", onPointerMove);
    globalThis.addEventListener("pointerup", onPointerUp);
    globalThis.addEventListener("pointercancel", onPointerUp);
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

  const titleBarChildren: VNode[] = [
    h("span", { class: "flex-1 text-xs text-toolbox-muted truncate" }, w.title || w.id) as VNode,
  ];
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

  // A declared width is authoritative (drop the min-width floor so it's exact);
  // otherwise the window sizes to its content above a sensible minimum.
  const containerClass = `fixed ${w.width === undefined ? "min-w-72" : ""} flex flex-col rounded-lg overflow-hidden ${isActive ? "ring-1 ring-focused" : ""}`;

  const titleBar = h("div", {
    class:
      "flex items-center h-9 bg-toolbox-deepest border-b border-toolbox-border px-3 cursor-move select-none touch-none",
    onPointerDown: drag.onTitlePointerDown,
    children: titleBarChildren,
  });

  const body = h("div", {
    class: "flex-1 bg-toolbox-surface p-3 flex flex-col gap-1 min-h-0",
    children: mapChildren(w.children, (child) => childToPreact(child, ctx)),
  });

  const menuBar = w.menus.length > 0 ? h(WindowMenuBar, { menus: w.menus }) : null;

  return h("div", {
    ref: drag.containerRef,
    class: containerClass,
    style: { left: state.x, top: state.y, zIndex: state.zIndex, width: w.width } as any,
    "data-toolbox-window": w.id,
    onPointerDown: () => {
      onFocusWindow(w.id);
    },
    children: menuBar ? [titleBar, menuBar, body] : [titleBar, body],
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

/**
 * Render one instance's windows for its own Preact root (ADR-0008). Unlike
 * `toPreact` there is no `fixed inset-0` wrapper — the host mounts this into a
 * zero-size per-instance container, and each Window is itself `position: fixed`,
 * so containers never overlap or capture pointer events, and z-order stays pure
 * CSS across instances.
 */
export function toPreactInstance(
  windows: WindowNode[],
  windowStates: ReadonlyMap<string, WindowState>,
  activeWindowId: string | null,
  onFocusWindow: (id: string) => void,
  onMoveWindow: (id: string, x: number, y: number) => void,
): VNode {
  const ctx: RenderContext = { windowStates, activeWindowId, onFocusWindow, onMoveWindow };
  return h(Fragment, null, ...windows.map((w) => h(Window, { w, ctx, key: w.id }))) as VNode;
}
