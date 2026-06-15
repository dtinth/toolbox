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
  let isOpen: boolean;
  if (input.runningCount === 0) {
    isOpen = !input.userDismissed || input.userToggledOpen;
  } else {
    isOpen = input.userToggledOpen;
  }
  return { isOpen, canClose: input.runningCount > 0 };
}
