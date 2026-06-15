import { describe, expect, it } from "vite-plus/test";
import { computePaletteVisibility } from "./palette-visibility.ts";

describe("computePaletteVisibility", () => {
  it("forces the palette open and disallows closing when no tools are running, even if user toggled closed", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 0,
    });
    expect(result.isOpen).toBe(true);
    expect(result.canClose).toBe(false);
  });
});
