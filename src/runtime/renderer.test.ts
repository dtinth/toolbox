import { describe, expect, it } from "vite-plus/test";
import { toPreact } from "./renderer.tsx";
import type { WindowNode } from "./collector.ts";
import { h } from "preact";

describe("toPreact", () => {
  it("converts a window with a label to a Preact element", () => {
    const tree: WindowNode[] = [
      { kind: "window", title: "Hello", children: [{ kind: "label", text: "Hi" }] },
    ];
    const el = toPreact(tree) as ReturnType<typeof h>;
    expect(el).toBeTruthy();
  });
});
