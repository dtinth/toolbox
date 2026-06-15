import { describe, expect, it } from "vite-plus/test";
import { computePaletteVisibility } from "./palette-visibility.ts";

describe("computePaletteVisibility", () => {
  it("auto-opens the palette on first load with no tools running", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 0,
      userDismissed: false,
    });
    expect(result.isOpen).toBe(true);
    expect(result.canClose).toBe(false);
  });

  it("re-opens the palette after the last tool closes (userDismissed cleared)", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 0,
      userDismissed: false,
    });
    expect(result.isOpen).toBe(true);
  });

  it("stays closed after the user dismissed the palette by launching a tool", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 0,
      userDismissed: true,
    });
    expect(result.isOpen).toBe(false);
  });

  it("opens the palette and allows closing when tools are running and the user has toggled it open", () => {
    const result = computePaletteVisibility({
      userToggledOpen: true,
      runningCount: 2,
      userDismissed: false,
    });
    expect(result.isOpen).toBe(true);
    expect(result.canClose).toBe(true);
  });

  it("keeps the palette closed and allows closing when tools are running and the user has toggled it closed", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 1,
      userDismissed: false,
    });
    expect(result.isOpen).toBe(false);
    expect(result.canClose).toBe(true);
  });
});
