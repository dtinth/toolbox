import { describe, expect, it } from "vite-plus/test";
import { type RenderContext, toPreact, renderNode, windowToPreact } from "./renderer.tsx";
import type { WindowNode, ChildNode } from "./collector.ts";
import type { WindowState } from "./runtime.ts";
import { h } from "preact";
import type { VNode } from "preact";

const noop = () => {};

// Build a RenderContext + an inert drag (containerRef/handler) for testing the
// pure window markup directly, without mounting the Window component.
function makeCtx(states: Map<string, WindowState>, active: string | null = null): RenderContext {
  return { windowStates: states, activeWindowId: active, onFocusWindow: noop, onMoveWindow: noop };
}
const inertDrag = { containerRef: { current: null }, onTitlePointerDown: noop };

describe("toPreact", () => {
  it("renders one keyed Window component per window in the desktop container", () => {
    const tree: WindowNode[] = [
      { kind: "window", id: "a", title: "A", children: [], menus: [] },
      { kind: "window", id: "b", title: "B", children: [], menus: [] },
    ];
    const states = new Map<string, WindowState>();
    const el = toPreact(tree, states, null, noop, noop) as any;
    expect(el.type).toBe("div");
    const children = el.props.children;
    expect(children).toHaveLength(2);
    // Each window is a component vnode keyed by its id (so per-window state
    // survives reconciliation as windows open/close/reorder).
    expect(typeof children[0].type).toBe("function");
    expect(children[0].key).toBe("a");
    expect(children[1].key).toBe("b");
  });
});

describe("windowToPreact (pure window markup)", () => {
  it("marks the window container with data-toolbox-window and wires the container ref", () => {
    const w: WindowNode = { kind: "window", id: "win1", title: "Win", children: [], menus: [] };
    const drag = { containerRef: { current: null }, onTitlePointerDown: noop };
    const el = windowToPreact(w, makeCtx(new Map()), drag) as any;
    expect(el.props["data-toolbox-window"]).toBe("win1");
    // preact lifts `ref` onto the vnode, not into props
    expect(el.ref).toBe(drag.containerRef);
  });

  it("wires the title bar's pointer-down to the drag handler", () => {
    const w: WindowNode = { kind: "window", id: "w", title: "W", children: [], menus: [] };
    let down = false;
    const drag = { containerRef: { current: null }, onTitlePointerDown: () => (down = true) };
    const el = windowToPreact(w, makeCtx(new Map()), drag) as any;
    const titleBar = el.props.children[0];
    titleBar.props.onPointerDown(new Event("pointerdown") as PointerEvent);
    expect(down).toBe(true);
  });

  it("renders a close button when the window has an onClose handler", () => {
    const w: WindowNode = {
      kind: "window",
      id: "w",
      title: "W",
      children: [],
      menus: [],
      onClose: () => {},
    };
    const el = windowToPreact(w, makeCtx(new Map()), inertDrag) as any;
    const titleBar = el.props.children[0];
    expect(titleBar.props.children[1]).toBeTruthy();
  });

  it("does not render a close button when onClose is undefined", () => {
    const w: WindowNode = { kind: "window", id: "w", title: "W", children: [], menus: [] };
    const el = windowToPreact(w, makeCtx(new Map()), inertDrag) as any;
    const titleBar = el.props.children[0];
    expect(titleBar.props.children.length).toBe(1);
  });

  it("applies the focus ring class to the active window", () => {
    const w: WindowNode = { kind: "window", id: "w", title: "W", children: [], menus: [] };
    const el = windowToPreact(w, makeCtx(new Map(), "w"), inertDrag) as any;
    expect(el.props.class).toContain("ring-focused");
  });

  it("renders a spinner child with data-toolbox-spinner", () => {
    const w: WindowNode = {
      kind: "window",
      id: "w",
      title: "Loading",
      children: [{ kind: "spinner" }],
      menus: [],
    };
    const el = windowToPreact(w, makeCtx(new Map(), "w"), inertDrag) as any;
    const body = el.props.children[1];
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

describe("custom widgets and identity groups", () => {
  it("renders a custom node via a component that runs its render closure", () => {
    const marker = h("canvas", { id: "scribble" }) as VNode;
    const w: WindowNode = {
      kind: "window",
      id: "w",
      title: "W",
      menus: [],
      children: [{ kind: "custom", render: () => marker }],
    };
    const el = windowToPreact(w, makeCtx(new Map()), inertDrag) as any;
    const body = el.props.children[1];
    const custom = body.props.children[0];
    // A stable component wrapper (so the live Preact mount survives redraws).
    expect(typeof custom.type).toBe("function");
    expect(custom.key).toBe("1:0");
    // Invoking the wrapper runs the tool's render closure.
    expect(custom.type(custom.props)).toBe(marker);
  });

  it("keys children by (group, position) and skips identityGroup markers", () => {
    const w: WindowNode = {
      kind: "window",
      id: "w",
      title: "W",
      menus: [],
      children: [
        { kind: "label", text: "a" },
        { kind: "identityGroup", group: "editors" },
        { kind: "label", text: "b" },
        { kind: "identityGroup" },
        { kind: "label", text: "c" },
      ],
    };
    const el = windowToPreact(w, makeCtx(new Map()), inertDrag) as any;
    const kids = el.props.children[1].props.children;
    expect(kids).toHaveLength(3);
    expect(kids.map((k: any) => k.key)).toEqual(["1:0", "editors:0", "2:0"]);
  });
});
