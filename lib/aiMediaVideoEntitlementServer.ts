import "server-only";

import {
  getAiMediaVideoMaxDuration,
  AI_MEDIA_VIDEO_DURATION_OPTIONS,
  AI_MEDIA_VIDEO_MAX_DURATION_SECONDS,
  type AiMediaEdition,
  type AiMediaVideoDurationLimit,
} from "@/lib/aiMediaGenerationQuotaPolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const AI_MEDIA_VIDEO_DURATIONS = AI_MEDIA_VIDEO_DURATION_OPTIONS;

export type AiMediaVideoEntitlement = {
  maxDurationSeconds: AiMediaVideoDurationLimit;
  allowedDurationsSeconds: AiMediaVideoDurationLimit[];
  source: "account" | "plan" | "fallback";
};

async function readPlanDuration(edition: AiMediaEdition) {
  try {
    const result = await supabaseAdmin
      .from("ai_media_plan_limits")
      .select("video_max_duration_seconds")
      .eq("edition", edition)
      .maybeSingle();
    return result.error
      ? null
      : validDurationLimit(result.data?.video_max_duration_seconds);
  } catch {
    return null;
  }
}

async function readAccountDuration(accountId: string) {
  try {
    const result = await supabaseAdmin
      .from("ai_media_account_limits")
      .select("video_max_duration_seconds_override")
      .eq("account_id", accountId)
      .maybeSingle();
    return result.error
      ? null
      : validDurationLimit(result.data?.video_max_duration_seconds_override);
  } catch {
    return null;
  }
}

function validDurationLimit(value: unknown): AiMediaVideoDurationLimit | null {
  const parsed = Number(value);
  // A historical ceiling below four seconds keeps the account restricted.
  // It cannot become a new output duration or silently lift the account cap.
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= AI_MEDIA_VIDEO_MAX_DURATION_SECONDS
    ? (parsed as AiMediaVideoDurationLimit)
    : null;
}

/**
 * Supabase is the commercial source of truth. The code default is deliberately
 * kept as a fail-safe so a missing column during a rolling deployment never
 * turns into a generation outage.
 */
export async function getAiMediaVideoEntitlement(args: {
  accountId: string;
  edition: AiMediaEdition;
}): Promise<AiMediaVideoEntitlement> {
  const fallback = getAiMediaVideoMaxDuration(args.edition);
  const [planLimit, accountLimit] = await Promise.all([
    readPlanDuration(args.edition),
    readAccountDuration(args.accountId),
  ]);
  const maxDurationSeconds = accountLimit ?? planLimit ?? fallback;

  return {
    maxDurationSeconds,
    allowedDurationsSeconds: AI_MEDIA_VIDEO_DURATIONS.filter(
      (duration) => duration <= maxDurationSeconds,
    ),
    source: accountLimit ? "account" : planLimit ? "plan" : "fallback",
  };
}
