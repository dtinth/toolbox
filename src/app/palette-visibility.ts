export interface PaletteVisibilityInput {
  userToggledOpen: boolean;
  runningCount: number;
}

export interface PaletteVisibilityResult {
  isOpen: boolean;
  canClose: boolean;
  isUserToggled: boolean;
}

export function computePaletteVisibility(input: PaletteVisibilityInput): PaletteVisibilityResult {
  const isOpen = input.runningCount === 0 || input.userToggledOpen;
  const canClose = input.runningCount > 0;
  return { isOpen, canClose, isUserToggled: input.userToggledOpen };
}
