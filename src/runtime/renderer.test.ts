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

  it("renders an empty file box (focusable) with the placeholder label", () => {
    const el = renderNode(
      { kind: "file", file: null, label: "Drop a blob", resolve: () => {} },
      noChild,
    ) as any;
    expect(el.type).toBe("div");
    expect(el.props.tabindex).toBe(0);
    expect(el.props["data-toolbox-file"]).toBe("");
    // body is the placeholder span; hidden input is the second child
    const [body, input] = el.props.children;
    expect(body.props.children).toBe("Drop a blob");
    expect(input.type).toBe("input");
    expect(input.props.type).toBe("file");
    expect(input.props.class).toContain("hidden");
  });

  it("renders file metadata (name, type, size) when a file is present", () => {
    const file = new File(["abcde"], "note.txt", { type: "text/plain" });
    const el = renderNode({ kind: "file", file, resolve: () => {} }, noChild) as any;
    const [body] = el.props.children;
    const [nameRow, meta] = body.props.children;
    expect(nameRow.props.children[1].props.children).toBe("note.txt");
    expect(meta.props.children).toBe("text/plain · 5 B");
  });

  it("delivers selected files through resolve via the hidden input onChange", () => {
    const delivered: File[][] = [];
    const el = renderNode(
      { kind: "file", file: null, resolve: (files) => delivered.push(files) },
      noChild,
    ) as any;
    const input = el.props.children[1];
    const file = new File(["x"], "x.bin", { type: "application/octet-stream" });
    input.props.onChange({ currentTarget: { files: [file], value: "" } });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toEqual([file]);
  });
});
