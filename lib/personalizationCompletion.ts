import {
  normalizeAiBusinessKnowledge,
  normalizeAiMemory,
} from "./aiMemory.ts";
import {
  AI_CTA_CHANNELS,
  isAiChannelCtaComplete,
  normalizeAiChannelCtaMap,
  type AiChannelCtaDestinations,
} from "./aiChannelCtaPreferences.ts";
import { hasBusinessWeeklySchedule } from "./businessWeeklySchedule.ts";
import { normalizeSiteWebChannelMap } from "./siteWebChannel.ts";

/** These fields belong to the company, never to optional writing instructions. */
export type PersonalizationCompanyContext = {
  companyName?: unknown;
  phone?: unknown;
  contactEmail?: unknown;
  logoPath?: unknown;
  logoUrl?: unknown;
  postalCode?: unknown;
  city?: unknown;
  sector?: unknown;
  profession?: unknown;
};

export type CompletionSection = {
  points: number;
  maxPoints: number;
  /** Keep the fraction until the final score or its presentation is rounded. */
  percent: number;
};

export type CompanyCompletion = CompletionSection & {
  sections: Record<"profile" | "activity" | "audience" | "local" | "identity", CompletionSection>;
};

function filled(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function section(points: number, maxPoints: number): CompletionSection {
  return { points, maxPoints, percent: points / maxPoints * 100 };
}

/** The five company sections contribute 5 + 30 + 15 + 10 + 15 = 75 points. */
export function getCompanyCompletion(
  memory: unknown,
  businessKnowledge: unknown,
  context?: PersonalizationCompanyContext,
): CompanyCompletion {
  const normalized = normalizeAiMemory(memory, { includePremium: true });
  const business = normalizeAiBusinessKnowledge(businessKnowledge);
  const sections: CompanyCompletion["sections"] = {
    profile: section(
      (filled(context?.companyName) ? 2 : 0)
      + (filled(context?.phone) ? 1 : 0)
      + (filled(context?.contactEmail) ? 1 : 0)
      + (filled(context?.logoPath) || filled(context?.logoUrl) ? 1 : 0),
      5,
    ),
    activity: section(
      (filled(context?.sector) ? 6 : 0)
      + (filled(context?.profession) ? 6 : 0)
      + (business.description.length >= 80 || normalized.detailedDescription.length >= 80 ? 8 : 0)
      + (business.services.length >= 1 ? 6 : 0)
      + (normalized.specialties.length >= 2 ? 4 : 0),
      30,
    ),
    audience: section(
      (business.customerTypes.length >= 1 ? 5 : 0)
      + (normalized.targetAudiences.length >= 1 ? 5 : 0)
      + (normalized.customerNeeds.length >= 1 ? 5 : 0),
      15,
    ),
    local: section(
      (business.interventionZones.length >= 1 ? 6 : 0)
      + (filled(context?.postalCode) && filled(context?.city) ? 2 : 0)
      + (hasBusinessWeeklySchedule(business.weeklySchedule) ? 2 : 0),
      10,
    ),
    identity: section(
      (business.strengths.length >= 1 || normalized.differentiators.length >= 1 ? 5 : 0)
      + (normalized.mission.length >= 30 ? 3 : 0)
      + (normalized.values.length >= 1 ? 2 : 0)
      + (normalized.brandPersonality.length >= 1 ? 3 : 0)
      + (normalized.commitments.length >= 1 ? 2 : 0),
      15,
    ),
  };
  return {
    ...section(Object.values(sections).reduce((total, value) => total + value.points, 0), 75),
    sections,
  };
}

/** Only the six fields in Objectives and strategy can earn these 10 points. */
export function getStrategyCompletion(memory: unknown): CompletionSection {
  const normalized = normalizeAiMemory(memory, { includePremium: true });
  const checks = [
    normalized.offersAndArguments.length >= 40,
    normalized.keyArguments.length >= 30,
    normalized.proofsAndObjections.length >= 40,
    normalized.objectionResponses.length >= 30,
    normalized.editorialStrategy.length >= 40,
    normalized.campaignCalendar.length >= 30,
  ];
  return section(10 * checks.filter(Boolean).length / checks.length, 10);
}

/** All visible CTA channels require an explicit, active and usable selection. */
export function getCtaCompletion(
  value: unknown,
  destinations: AiChannelCtaDestinations | null | undefined,
  metaPilotEnabled = false,
): CompletionSection & { configuredCount: number; totalCount: number } {
  const configured = normalizeAiChannelCtaMap(value);
  const raw = normalizeSiteWebChannelMap(value);
  const visible = AI_CTA_CHANNELS.filter(({ key }) => key !== "threads" || metaPilotEnabled);
  const configuredCount = visible.filter(({ key }) => {
    const config = configured[key];
    if (!config || config.choice === "none") return false;
    const original = raw[key];
    const originalPhone = original && typeof original === "object" && !Array.isArray(original)
      ? (original as Record<string, unknown>).phone : undefined;
    if (originalPhone !== undefined && originalPhone !== null && typeof originalPhone !== "string") return false;
    // Preserve invalid explicit overrides: normalization must not silently turn
    // an invalid phone into a valid fallback from the company profile.
    return isAiChannelCtaComplete(key, {
      ...config,
      phone: typeof originalPhone === "string" ? originalPhone : config.phone,
    }, destinations);
  }).length;
  return {
    ...section(15 * configuredCount / visible.length, 15),
    configuredCount,
    totalCount: visible.length,
  };
}

function boundedPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

/** Round once, after the agreed 75 / 15 / 10 weighting has been applied. */
export function getPersonalizationScore(
  companyPercent: number,
  ctaPercent: number,
  strategyPercent: number,
): number {
  return Math.round(
    boundedPercent(companyPercent) * 0.75
    + boundedPercent(ctaPercent) * 0.15
    + boundedPercent(strategyPercent) * 0.10,
  );
}
