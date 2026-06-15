import { describe, expect, it } from "vite-plus/test";
import { toPreact } from "./renderer.tsx";
import type { WindowNode } from "./collector.ts";
import type { WindowState } from "./runtime.ts";
import { h } from "preact";

describe("toPreact", () => {
  const noop = () => {};

  it("renders a window with a label inside the desktop container", () => {
    const tree: WindowNode[] = [
      { kind: "window", id: "__main__", title: "Hello", children: [{ kind: "label", text: "Hi" }] },
    ];
    const states = new Map<string, WindowState>([["__main__", { x: 100, y: 100, zIndex: 1 }]]);
    const el = toPreact(tree, states, "__main__", noop, noop) as ReturnType<typeof h>;
    expect(el).toBeTruthy();
  });

  it("marks the window container with data-toolbox-window attribute", () => {
    const tree: WindowNode[] = [{ kind: "window", id: "win1", title: "Win", children: [] }];
    const states = new Map<string, WindowState>([["win1", { x: 0, y: 0, zIndex: 0 }]]);
    const el = toPreact(tree, states, null, noop, noop) as ReturnType<typeof h>;
    const windowDiv = (el as any).props.children[0];
    expect(windowDiv.props["data-toolbox-window"]).toBe("win1");
  });

  it("renders a close button when window has an onClose handler", () => {
    const tree: WindowNode[] = [
      { kind: "window", id: "w", title: "W", children: [], onClose: () => {} },
    ];
    const states = new Map<string, WindowState>([["w", { x: 0, y: 0, zIndex: 0 }]]);
    const el = toPreact(tree, states, null, noop, noop) as ReturnType<typeof h>;
    const windowDiv = (el as any).props.children[0];
    const titleBar = windowDiv.props.children[0];
    const closeBtn = titleBar.props.children[1];
    expect(closeBtn).toBeTruthy();
  });

  it("does not render close button when onClose is undefined", () => {
    const tree: WindowNode[] = [{ kind: "window", id: "w", title: "W", children: [] }];
    const states = new Map<string, WindowState>([["w", { x: 0, y: 0, zIndex: 0 }]]);
    const el = toPreact(tree, states, null, noop, noop) as ReturnType<typeof h>;
    const windowDiv = (el as any).props.children[0];
    const titleBar = windowDiv.props.children[0];
    expect(titleBar.props.children.length).toBe(1);
  });

  it("applies the focus ring class to the active window", () => {
    const tree: WindowNode[] = [{ kind: "window", id: "w", title: "W", children: [] }];
    const states = new Map<string, WindowState>([["w", { x: 0, y: 0, zIndex: 0 }]]);
    const el = toPreact(tree, states, "w", noop, noop) as ReturnType<typeof h>;
    const windowDiv = (el as any).props.children[0];
    expect(windowDiv.props.class).toContain("ring-focused");
  });
});
