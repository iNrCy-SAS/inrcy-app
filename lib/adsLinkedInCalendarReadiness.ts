import type { AdsCampaignInput } from "./adsValidation.ts";
import { linkedInAdsCampaignGroupIsCompatible, selectLinkedInAdsCampaignGroup, type LinkedInAdsCampaignGroup } from "./adsLinkedInPreflightPolicy.ts";
import { linkedInAdsCampaignScheduleIssues } from "./adsLinkedInPublish.ts";

export function linkedInCalendarIssue(draft: AdsCampaignInput, group: LinkedInAdsCampaignGroup | null, nowMs = Date.now()): string {
  const startAt = draft.linkedinDeliverySettings?.budget.startAt;
  const endAt = draft.linkedinDeliverySettings?.budget.endAt;
  const groupSchedule = group?.runSchedule || {};
  const startAtMs = startAt ? Date.parse(startAt) : Math.max(nowMs + 300_000, groupSchedule.start || 0);
  const endAtMs = endAt ? Date.parse(endAt) : Date.parse(`${draft.endDate}T23:59:59Z`);
  if (!Number.isFinite(startAtMs) || startAtMs < nowMs + 60_000) return "La date de début est passée ou trop proche. Choisissez un début dès la validation ou une date future à l’étape Budget et calendrier.";
  if (!Number.isFinite(endAtMs) || endAtMs <= startAtMs) return "La date de fin doit être postérieure au début de diffusion. Corrigez le calendrier à l’étape Budget et calendrier.";
  if (endAtMs > nowMs + 90 * 86_400_000) return "La date de fin dépasse les 90 jours pris en charge. Corrigez-la à l’étape Budget et calendrier.";
  if (group && linkedInAdsCampaignScheduleIssues({ startAtMs, endAtMs, groupSchedule, nowMs }).length) {
    return "Le calendrier de cette campagne dépasse la période du groupe LinkedIn choisi. Choisissez un groupe compatible ou adaptez les dates à l’étape Budget et calendrier.";
  }
  return "";
}

/** Only an AI-proposed end may be shortened to an existing, verified group. */
export function prepareLinkedInPlanForGroup(draft: AdsCampaignInput, input: {
  groups: readonly LinkedInAdsCampaignGroup[];
  manualGroupId: string | null;
  endIsExplicit: boolean;
  nowMs?: number;
}): AdsCampaignInput {
  const nowMs = input.nowMs ?? Date.now();
  const objectiveType = draft.channelSettings?.channel === "linkedin" ? draft.channelSettings.objectiveType : "WEBSITE_VISIT";
  const explicitGroupId = input.manualGroupId === draft.linkedinCampaignGroupId ? input.manualGroupId || undefined : undefined;
  const groups = input.groups.filter((group) => linkedInAdsCampaignGroupIsCompatible(group, objectiveType)
    && (!draft.linkedinOrganizationUrn || !group.organizationUrn || group.organizationUrn === draft.linkedinOrganizationUrn));
  const options = { selectedId: explicitGroupId, objectiveType, organizationUrn: draft.linkedinOrganizationUrn };
  const existing = groups.find((group) => group.id === draft.linkedinCampaignGroupId);
  if (existing && !linkedInCalendarIssue(draft, existing, nowMs)) return draft;
  const compatible = selectLinkedInAdsCampaignGroup(groups, { ...options,
    scheduleIsCompatible: (group) => !linkedInCalendarIssue(draft, group, nowMs) });
  if (compatible && !linkedInCalendarIssue(draft, compatible, nowMs)) return { ...draft, linkedinCampaignGroupId: compatible.id };
  if (!input.endIsExplicit && draft.linkedinDeliverySettings) {
    const adjusted = new Map<string, AdsCampaignInput>();
    for (const group of groups) {
      const proposedEnd = Date.parse(draft.linkedinDeliverySettings.budget.endAt || `${draft.endDate}T23:59:59Z`);
      const groupEnd = group.runSchedule.end;
      if (!groupEnd || !Number.isFinite(groupEnd) || groupEnd <= nowMs + 86_400_000 || proposedEnd <= groupEnd) continue;
      const endAt = new Date(groupEnd - 1_000).toISOString();
      const candidate = { ...draft, endDate: endAt.slice(0, 10), linkedinCampaignGroupId: group.id,
        linkedinDeliverySettings: { ...draft.linkedinDeliverySettings, budget: { ...draft.linkedinDeliverySettings.budget, endAt } } };
      if (!linkedInCalendarIssue(candidate, group, nowMs)) adjusted.set(group.id, candidate);
    }
    const group = selectLinkedInAdsCampaignGroup(groups, { ...options, scheduleIsCompatible: (candidate) => adjusted.has(candidate.id) });
    if (group && adjusted.has(group.id)) return adjusted.get(group.id)!;
  }
  // An explicit group/date remains a human choice. Automatic preflight can
  // choose another verified group only when no explicit group was requested.
  return explicitGroupId ? draft : { ...draft, linkedinCampaignGroupId: "" };
}
