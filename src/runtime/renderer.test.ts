import { describe, expect, it } from "vite-plus/test";
import { toPreact, renderNode } from "./renderer.tsx";
import type { WindowNode, ChildNode } from "./collector.ts";
import type { WindowState } from "./runtime.ts";
import { h } from "preact";
import type { VNode } from "preact";

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

  it("renders a spinner node with data-toolbox-spinner", () => {
    const tree: WindowNode[] = [
      {
        kind: "window",
        id: "w",
        title: "Loading",
        children: [{ kind: "spinner" }],
      },
    ];
    const states = new Map<string, WindowState>([["w", { x: 0, y: 0, zIndex: 0 }]]);
    const el = toPreact(tree, states, "w", noop, noop) as ReturnType<typeof h>;
    const windowDiv = (el as any).props.children[0];
    const body = windowDiv.props.children[1];
    const children = body.props.children;
    const spinnerContainer = Array.isArray(children) ? children[0] : children;
    expect(spinnerContainer.props["data-toolbox-spinner"]).toBe("");
  });
});

// A trivial renderChild stub for leaf node tests that need no child resolution.
const noChild = (): VNode => h("span", null) as VNode;

// Recursively collect all text from a vnode tree.
const collectText = (n: any): string => {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(collectText).join("");
  return collectText(n.props?.children);
};

// Find the first vnode matching pred (depth-first).
const findVNode = (n: any, pred: (x: any) => boolean): any => {
  if (n == null || typeof n !== "object") return null;
  if (Array.isArray(n)) {
    for (const c of n) {
      const r = findVNode(c, pred);
      if (r) return r;
    }
    return null;
  }
  if (pred(n)) return n;
  return findVNode(n.props?.children, pred);
};

describe("renderNode (pure node renderer)", () => {
  it("renders a label as a div with the text content", () => {
    const el = renderNode({ kind: "label", text: "Hello world" }, noChild) as any;
    expect(el.type).toBe("div");
    expect(el.props.children).toBe("Hello world");
  });

  it("renders a button with the label text and wires onClick", () => {
    const onClick = () => {};
    const el = renderNode({ kind: "button", label: "Click me", onClick }, noChild) as any;
    expect(el.type).toBe("button");
    expect(el.props.children).toBe("Click me");
    expect(el.props.onClick).toBe(onClick);
  });

  it("renders a button without onClick when handler is omitted", () => {
    const el = renderNode({ kind: "button", label: "No-op" }, noChild) as any;
    expect(el.type).toBe("button");
    expect(el.props.onClick).toBeUndefined();
  });

  it("renders a textInput as an <input type=text> and wires onInput→onChange", () => {
    const values: string[] = [];
    const onChange = (v: string) => values.push(v);
    const el = renderNode(
      { kind: "textInput", value: "init", placeholder: "ph", onChange },
      noChild,
    ) as any;
    expect(el.type).toBe("input");
    expect(el.props.type).toBe("text");
    expect(el.props.value).toBe("init");
    expect(el.props.placeholder).toBe("ph");
    // Simulate the onInput handler firing
    const fakeInput = { value: "typed" } as HTMLInputElement;
    el.props.onInput({ currentTarget: fakeInput });
    expect(values).toEqual(["typed"]);
  });

  it("renders a textarea with default rows=6 and wires onInput→onChange", () => {
    const values: string[] = [];
    const onChange = (v: string) => values.push(v);
    const el = renderNode(
      { kind: "textarea", value: "draft", placeholder: "ph", onChange },
      noChild,
    ) as any;
    expect(el.type).toBe("textarea");
    expect(el.props.value).toBe("draft");
    expect(el.props.rows).toBe(6);
    const fakeArea = { value: "updated" } as HTMLTextAreaElement;
    el.props.onInput({ currentTarget: fakeArea });
    expect(values).toEqual(["updated"]);
  });

  it("respects an explicit rows value on textarea", () => {
    const el = renderNode({ kind: "textarea", value: "", rows: 10 }, noChild) as any;
    expect(el.props.rows).toBe(10);
  });

  it("renders a spinner with data-toolbox-spinner attribute", () => {
    const el = renderNode({ kind: "spinner" }, noChild) as any;
    expect(el.props["data-toolbox-spinner"]).toBe("");
    // The spinner inner element is a span with animate-spin
    expect(el.props.children.type).toBe("span");
    expect(el.props.children.props.class).toContain("animate-spin");
  });

  it("renders a row as a flex div and delegates children to renderChild", () => {
    const rendered: ChildNode[] = [];
    const stubChild = (child: ChildNode): VNode => {
      rendered.push(child);
      return h("span", { key: (child as any).kind }) as VNode;
    };
    const labelA: ChildNode = { kind: "label", text: "A" };
    const labelB: ChildNode = { kind: "label", text: "B" };
    const el = renderNode({ kind: "row", children: [labelA, labelB] }, stubChild) as any;
    expect(el.type).toBe("div");
    expect(el.props.class).toContain("flex");
    // Both children were delegated to the stub
    expect(rendered).toEqual([labelA, labelB]);
  });

  it("renders a focusable empty file box with the placeholder label", () => {
    const el = renderNode(
      { kind: "file", file: null, label: "Drop a blob", resolve: () => {} },
      noChild,
    ) as any;
    expect(el.type).toBe("div");
    expect(el.props.tabindex).toBe(0);
    expect(el.props["data-toolbox-file"]).toBe("");
    expect(collectText(el)).toContain("Drop a blob");
  });

  it("renders file metadata (name, type, size) when a file is present", () => {
    const file = new File(["abcde"], "note.txt", { type: "text/plain" });
    const el = renderNode({ kind: "file", file, resolve: () => {} }, noChild) as any;
    const text = collectText(el);
    expect(text).toContain("note.txt");
    expect(text).toContain("text/plain · 5 B");
  });

  it("delivers dropped files through resolve and prevents default", () => {
    const delivered: File[][] = [];
    const el = renderNode(
      { kind: "file", file: null, resolve: (files) => delivered.push(files) },
      noChild,
    ) as any;
    const file = new File(["y"], "y.png", { type: "image/png" });
    let prevented = false;
    el.props.onDrop({
      preventDefault: () => {
        prevented = true;
      },
      currentTarget: { classList: { toggle: () => {} } },
      dataTransfer: { files: [file], getData: () => "" },
    });
    expect(prevented).toBe(true);
    expect(delivered[0]).toEqual([file]);
  });

  it("allows drop by preventing default on dragover", () => {
    const el = renderNode({ kind: "file", file: null, resolve: () => {} }, noChild) as any;
    let prevented = false;
    el.props.onDragOver({
      preventDefault: () => {
        prevented = true;
      },
      currentTarget: { classList: { toggle: () => {} } },
    });
    expect(prevented).toBe(true);
  });

  it("delivers pasted clipboard data through resolve (focus-scoped paste)", () => {
    const delivered: File[][] = [];
    const el = renderNode(
      { kind: "file", file: null, resolve: (files) => delivered.push(files) },
      noChild,
    ) as any;
    const file = new File(["z"], "z.png", { type: "image/png" });
    let prevented = false;
    el.props.onPaste({
      preventDefault: () => {
        prevented = true;
      },
      clipboardData: { files: [file], getData: () => "" },
    });
    expect(prevented).toBe(true);
    expect(delivered[0]).toEqual([file]);
  });

  it("mounts a … menu component (portaled popover; rendered/positioned in the browser)", () => {
    const el = renderNode({ kind: "file", file: null, resolve: () => {} }, noChild) as any;
    // The menu is a component (FileMenu) so it can use hooks + floating-ui +
    // a portal; its actions are verified end-to-end in the browser, not here.
    const component = findVNode(el, (n) => typeof n.type === "function");
    expect(component).toBeTruthy();
  });
});
