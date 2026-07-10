import { describe, expect, it } from "vite-plus/test";
import { computePaletteVisibility } from "./palette-visibility.ts";

describe("computePaletteVisibility", () => {
  it("auto-opens the palette on first load with no tools running", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 0,
      userDismissed: false,
    });
    expect(result.isOpen).toBeTruthy();
    expect(result.canClose).toBeFalsy();
  });

  it("re-opens the palette after the last tool closes (userDismissed cleared)", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 0,
      userDismissed: false,
    });
    expect(result.isOpen).toBeTruthy();
  });

  it("stays closed after the user dismissed the palette by launching a tool", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 0,
      userDismissed: true,
    });
    expect(result.isOpen).toBeFalsy();
  });

  it("opens the palette and allows closing when tools are running and the user has toggled it open", () => {
    const result = computePaletteVisibility({
      userToggledOpen: true,
      runningCount: 2,
      userDismissed: false,
    });
    expect(result.isOpen).toBeTruthy();
    expect(result.canClose).toBeTruthy();
  });

  it("keeps the palette closed and allows closing when tools are running and the user has toggled it closed", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 1,
      userDismissed: false,
    });
    expect(result.isOpen).toBeFalsy();
    expect(result.canClose).toBeTruthy();
  });
});
