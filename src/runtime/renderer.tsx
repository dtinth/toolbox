import { h, type ComponentChildren, type VNode } from "preact";
import type { ChildNode, Node, WindowNode } from "./collector.ts";

function nodeToPreact(node: Node): VNode {
  switch (node.kind) {
    case "label":
      return h("div", { class: "text-base" }, node.text) as VNode;
    case "button":
      return h(
        "button",
        {
          class: "rounded border px-2 py-1",
          onClick: node.onClick,
        },
        node.label,
      ) as VNode;
    case "row":
      return h(
        "div",
        { class: "flex flex-row items-center gap-2" },
        ...node.children.map(childToPreact),
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
        class: "rounded border px-2 py-1",
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
        class: "rounded border px-2 py-1 font-mono text-sm w-full",
      }) as VNode;
  }
}

function childToPreact(child: ChildNode): VNode {
  if (child.kind === "window") return windowToPreact(child);
  return nodeToPreact(child);
}

function windowToPreact(w: WindowNode): VNode {
  return h(
    "div",
    {
      class: "rounded-lg border bg-white shadow-md p-3 min-w-60",
      "data-toolbox-window": w.title,
    },
    h("div", { class: "text-sm font-semibold mb-2 text-neutral-700" }, w.title),
    h("div", { class: "flex flex-col gap-1" }, ...w.children.map(childToPreact)),
  ) as VNode;
}

export function toPreact(windows: WindowNode[]): VNode {
  const children: ComponentChildren[] = windows.map(windowToPreact);
  return h(
    "div",
    { class: "fixed inset-0 p-4 flex flex-wrap gap-4 items-start" },
    ...children,
  ) as VNode;
}
