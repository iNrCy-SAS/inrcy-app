import type { PinterestWizardSettings } from "./adsChannelWizardSettings";

export type PinterestTargetingTransition = {
  keywords: string[];
  removedSignalCount: number;
  requiresConfirmation: boolean;
};

/**
 * Pinterest automatic targeting cannot be combined with the manual discovery
 * signals stored in `keywords`. Returning the cleanup decision separately lets
 * the UI ask for confirmation before any professional choice is discarded.
 */
export function preparePinterestTargetingTransition(
  currentMode: PinterestWizardSettings["targetingMode"],
  nextMode: PinterestWizardSettings["targetingMode"],
  keywords: readonly string[],
): PinterestTargetingTransition {
  if (nextMode !== "automatic") {
    return { keywords: [...keywords], removedSignalCount: 0, requiresConfirmation: false };
  }

  const removedSignalCount = keywords.filter((value) => value.trim().length > 0).length;
  return {
    keywords: [],
    removedSignalCount,
    requiresConfirmation: currentMode !== "automatic" && removedSignalCount > 0,
  };
}
