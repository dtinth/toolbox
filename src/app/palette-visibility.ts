export interface PaletteVisibilityInput {
  userToggledOpen: boolean;
  runningCount: number;
  userDismissed: boolean;
}

export interface PaletteVisibilityResult {
  isOpen: boolean;
  canClose: boolean;
}

export function computePaletteVisibility(input: PaletteVisibilityInput): PaletteVisibilityResult {
  const isOpen =
    input.runningCount === 0
      ? !input.userDismissed || input.userToggledOpen
      : input.userToggledOpen;
  return { isOpen, canClose: input.runningCount > 0 };
}
