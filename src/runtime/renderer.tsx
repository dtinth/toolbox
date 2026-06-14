import { h, type ComponentChildren } from "preact";
import type { Node, WindowNode } from "./collector.ts";

function nodeToPreact(node: Node) {
  switch (node.kind) {
    case "label":
      return h("div", { class: "text-base" }, node.text);
    case "button":
      return h(
        "button",
        {
          class: "rounded border px-2 py-1",
          onClick: node.onClick,
        },
        node.label,
      );
  }
}

function windowToPreact(w: WindowNode) {
  return h(
    "div",
    {
      class: "rounded-lg border bg-white shadow-md p-3 min-w-60",
      "data-toolbox-window": w.title,
    },
    h("div", { class: "text-sm font-semibold mb-2 text-neutral-700" }, w.title),
    h("div", { class: "flex flex-col gap-1" }, ...w.children.map(nodeToPreact)),
  );
}

export function toPreact(windows: WindowNode[]) {
  const children: ComponentChildren[] = windows.map(windowToPreact);
  return h("div", { class: "fixed inset-0 p-4 flex flex-wrap gap-4 items-start" }, ...children);
}
