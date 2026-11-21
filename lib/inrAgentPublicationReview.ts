import {
  hasConfirmedInrAgentTiktokReview,
  pendingInrAgentPublicationChannels,
  preparedInrAgentPublicationChannels,
  selectedInrAgentPublicationChannels,
  unvalidatedInrAgentPublicationChannels,
} from "./inrAgentPublicationChannelSelection.ts";
import { normalizeBoosterPublishChannel } from "./inrAgentPublishChannels.ts";

export type PublicationReviewState = "validated" | "pending" | "creating" | "refused";

type ReviewAction = {
  id?: string;
  status: string;
  validatedAt?: string | null;
  completedAt?: string | null;
  scheduledFor?: string | null;
  validationRequired?: boolean | null;
  executionPolicy?: string | null;
  targetChannels?: string[];
  lastError?: string | null;
  payload?: Record<string, unknown> | null;
};

function reviewStates(action: ReviewAction, now: number, channel?: string | null): PublicationReviewState[] {
  const deadline = Date.parse(action.scheduledFor || "");
  if (action.status === "cancelled" || deadline <= now) return [];
  const requested = normalizeBoosterPublishChannel(channel);
  if (requested && !selectedInrAgentPublicationChannels(action.payload, [requested]).includes(requested)) return [];
  if (action.status === "refused") return ["refused"];
  if (action.completedAt || action.status === "completed") return ["validated"];

  const approved = Boolean(action.validatedAt || ["scheduled", "validated"].includes(action.status));
  const plan = action.payload?.editorialPlan as { state?: string } | undefined;
  const ready = ["prepared", "pending_validation", "pending"].includes(action.status)
    || action.status === "draft" && plan?.state === "ready";
  if (!approved && (!ready || (plan?.state && plan.state !== "ready"))) return ["creating"];
  if (approved && ["executing", "failed"].includes(action.status)) return ["validated"];

  const automatic = action.executionPolicy === "automatic_after_settings" || action.validationRequired === false;
  const base: PublicationReviewState = approved || automatic ? "validated" : "pending";
  const preparing = pendingInrAgentPublicationChannels(action.payload);
  const held = unvalidatedInrAgentPublicationChannels(action.payload);
  // Older automatic drafts may only have the provider rejection saved by the scheduler.
  const providerRequestedReview = automatic && action.status === "prepared" &&
    action.lastError === "TikTok attend la validation de ses paramètres avant programmation." &&
    !hasConfirmedInrAgentTiktokReview(action.payload, action.id);
  if (!held.length && !preparing.length && !providerRequestedReview) return [base];

  const prepared = preparedInrAgentPublicationChannels(action.payload, action.targetChannels || []);
  const selected = selectedInrAgentPublicationChannels(action.payload, prepared);
  const channelState = (key: string): PublicationReviewState => {
    if (preparing.includes(key)) return "creating";
    if (held.includes(key) || (providerRequestedReview && key === "tiktok")) return "pending";
    // A manual publication can only be approved once all its selected channels are prepared.
    if (!approved && !automatic && preparing.length) return "creating";
    return base;
  };
  if (requested && selected.includes(requested)) return [channelState(requested)];
  return selected.length ? [...new Set(selected.map(channelState))] : [base];
}

/** One item may cover approved channels and another channel awaiting its own review. */
export function publicationReviewStates(action: ReviewAction, now = Date.now()): PublicationReviewState[] {
  return reviewStates(action, now);
}

export function publicationChannelReviewState(action: ReviewAction | null | undefined, channel: string | null | undefined, now = Date.now()): PublicationReviewState | undefined {
  return action ? reviewStates(action, now, channel)[0] : undefined;
}
