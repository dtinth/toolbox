import { describe, expect, it } from "vite-plus/test";
import { collect, type Node, type Ui } from "./collector.ts";

describe("collector", () => {
  it("collects a window with a label into a vDOM tree", () => {
    const tree = collect((ui) => {
      ui.window("Hello", () => {
        ui.label("Hi there");
      });
    });
    expect(tree).toEqual([
      {
        kind: "window",
        title: "Hello",
        children: [{ kind: "label", text: "Hi there" }],
      },
    ]);
  });

  it("collects multiple windows in declaration order", () => {
    const tree = collect((ui) => {
      ui.window("A", () => ui.label("a"));
      ui.window("B", () => ui.label("b"));
    });
    expect(tree.map((w) => w.title)).toEqual(["A", "B"]);
  });

  it("collects nested widgets inside a window", () => {
    const tree = collect((ui) => {
      ui.window("Main", () => {
        ui.label("title");
        ui.button("OK", { onClick: () => {} });
      });
    });
    expect(tree[0]!.children).toHaveLength(2);
    const button = tree[0]!.children[1] as Extract<Node, { kind: "button" }>;
    expect(button.kind).toBe("button");
    expect(button.label).toBe("OK");
    expect(typeof button.onClick).toBe("function");
  });

  it("captures the onClick closure (so it can be invoked later)", () => {
    let clicked = 0;
    const tree = collect((ui) => {
      ui.window("Main", () => {
        ui.button("+", { onClick: () => clicked++ });
      });
    });
    const button = tree[0]!.children[0] as Extract<Node, { kind: "button" }>;
    button.onClick!();
    button.onClick!();
    expect(clicked).toBe(2);
  });

  it("returns an empty list when the declarator declares nothing", () => {
    const tree = collect((_ui: Ui) => {});
    expect(tree).toEqual([]);
  });

  it("collects a row of children into a horizontal container", () => {
    const tree = collect((ui) => {
      ui.window("Main", () => {
        ui.row(() => {
          ui.label("left");
          ui.button("right", {});
        });
      });
    });
    expect(tree[0]!.children[0]).toEqual({
      kind: "row",
      children: [
        { kind: "label", text: "left" },
        { kind: "button", label: "right", onClick: undefined },
      ],
    });
  });
});
