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
    // loadManifest normalizes the optional fields, so the entry always carries
    // `icon`/`description` keys (undefined when absent) — toStrictEqual checks them.
    expect(manifest.tools[0]).toStrictEqual({
      id: "hello",
      name: "Hello",
      icon: undefined,
      description: undefined,
    });
    expect(manifest.tools[1].icon).toBe("/tools/counter/icon.svg");
  });
});
