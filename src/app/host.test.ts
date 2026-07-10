import { describe, expect, it } from "vite-plus/test";
import { runningManifestIds } from "./host.ts";
import { type ToolInstanceInfo } from "../runtime/index.ts";

describe("runningManifestIds", () => {
  it("returns an empty set when there are no instances", () => {
    expect(runningManifestIds([])).toStrictEqual(new Set());
  });

  it("returns a set with a single manifestId for one instance", () => {
    const instances: ToolInstanceInfo[] = [
      { instanceId: "inst-1", manifestId: "counter", name: "Counter" },
    ];
    expect(runningManifestIds(instances)).toStrictEqual(new Set(["counter"]));
  });

  it("deduplicates manifestIds across multiple instances of the same tool", () => {
    const instances: ToolInstanceInfo[] = [
      { instanceId: "inst-1", manifestId: "counter", name: "Counter" },
      { instanceId: "inst-2", manifestId: "counter", name: "Counter" },
    ];
    expect(runningManifestIds(instances)).toStrictEqual(new Set(["counter"]));
  });

  it("aggregates manifestIds across instances of different tools", () => {
    const instances: ToolInstanceInfo[] = [
      { instanceId: "inst-1", manifestId: "counter", name: "Counter" },
      { instanceId: "inst-2", manifestId: "color-picker", name: "Color Picker" },
      { instanceId: "inst-3", manifestId: "counter", name: "Counter" },
    ];
    expect(runningManifestIds(instances)).toStrictEqual(new Set(["counter", "color-picker"]));
  });
});
