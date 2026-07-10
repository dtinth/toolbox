import { describe, expect, it } from "vite-plus/test";
import { loadManifest } from "./manifest.ts";

describe("manifest", () => {
  it("parses a manifest with tools", async () => {
    const json = JSON.stringify({
      tools: [
        { id: "hello", name: "Hello" },
        { id: "counter", name: "Counter", icon: "/tools/counter/icon.svg" },
      ],
    });
    const manifest = await loadManifest(() => Promise.resolve(json));
    expect(manifest.tools).toHaveLength(2);
    expect(manifest.tools[0]).toStrictEqual({ id: "hello", name: "Hello" });
    expect(manifest.tools[1].icon).toBe("/tools/counter/icon.svg");
  });
});
