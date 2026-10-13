export type InrStudioWorkspaceTab = "generate" | "modify" | "retouch";

/** A publication handoff reuses its existing subject; ordinary Studio stays free. */
export function getInrStudioInitialCreationMode(input: {
  source: string;
  origin: string;
  publicationBrief?: string;
  freeOnly?: boolean;
}): "guided" | "free" {
  return !input.freeOnly && (input.source === "booster" || input.origin === "booster")
    && Boolean(input.publicationBrief?.trim()) ? "guided" : "free";
}

type InrStudioHandoffPolicyInput = {
  hasExternalHandoff: boolean;
  hasSourceMedia: boolean;
};

/**
 * A handoff opened without a source is a creation session: it may generate
 * either an image or a video, but it cannot modify or retouch missing media.
 */
export function isInrStudioTabUnavailable(
  tab: InrStudioWorkspaceTab,
  input: InrStudioHandoffPolicyInput
) {
  return (
    input.hasExternalHandoff &&
    !input.hasSourceMedia &&
    tab !== "generate"
  );
}

/**
 * Switching Image / Video is part of the same generation session and must not
 * be mistaken for abandoning the originating editor. Source-based handoffs
 * stay pinned to their media type.
 */
export function canSwitchInrStudioMediaType(
  tab: InrStudioWorkspaceTab,
  hasExternalHandoff: boolean
) {
  return !hasExternalHandoff || tab === "generate";
}
