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

  it("opens the palette and allows closing when tools are running and the user has toggled it open", () => {
    const result = computePaletteVisibility({
      userToggledOpen: true,
      runningCount: 2,
    });
    expect(result.isOpen).toBe(true);
    expect(result.canClose).toBe(true);
  });

  it("keeps the palette closed and allows closing when tools are running and the user has toggled it closed", () => {
    const result = computePaletteVisibility({
      userToggledOpen: false,
      runningCount: 1,
    });
    expect(result.isOpen).toBe(false);
    expect(result.canClose).toBe(true);
  });

  it("reports isUserToggled as the user toggle, not the auto-open state", () => {
    expect(
      computePaletteVisibility({ userToggledOpen: false, runningCount: 0 }).isUserToggled,
    ).toBe(false);
    expect(computePaletteVisibility({ userToggledOpen: true, runningCount: 0 }).isUserToggled).toBe(
      true,
    );
    expect(computePaletteVisibility({ userToggledOpen: true, runningCount: 3 }).isUserToggled).toBe(
      true,
    );
    expect(
      computePaletteVisibility({ userToggledOpen: false, runningCount: 3 }).isUserToggled,
    ).toBe(false);
  });
});
