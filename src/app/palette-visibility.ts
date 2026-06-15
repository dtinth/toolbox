export interface PaletteVisibilityInput {
  userToggledOpen: boolean;
  runningCount: number;
}

export interface PaletteVisibilityResult {
  isOpen: boolean;
  canClose: boolean;
}

export function computePaletteVisibility(input: PaletteVisibilityInput): PaletteVisibilityResult {
  return {
    isOpen: input.runningCount === 0 || input.userToggledOpen,
    canClose: input.runningCount > 0,
  };
}
