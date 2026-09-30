/**
 * Campaign strategy has a dedicated, quality-first chain. None of these models
 * changes the professional's model preference in the other iNrCy modules.
 */
import { isPlannedAdsChannel } from "./adsChannelCapabilities.ts";

export const ADS_CAMPAIGN_MODEL_CHAIN = [
  "openai/gpt-5.6-terra",
  "anthropic/claude-sonnet-4.6",
  "mistral/mistral-medium-3.5",
  "google/gemini-3-flash",
] as const;

export const ADS_CAMPAIGN_MAX_ATTEMPTS = 4;

export const DEFAULT_ADS_CAMPAIGN_STRATEGIST_MODEL = ADS_CAMPAIGN_MODEL_CHAIN[0];

export function resolveAdsCampaignStrategistModel() {
  return DEFAULT_ADS_CAMPAIGN_STRATEGIST_MODEL;
}

/** Native Ads briefs require a location, which the model is not allowed to invent. */
export function adsPlanNeedsTrustedLocation(provider: string, zones: readonly string[], city: string): boolean {
  return isPlannedAdsChannel(provider) && !zones.some((zone) => zone.trim()) && !city.trim();
}

export class AdsCampaignModelChainError extends Error {
  readonly code = "ads_campaign_models_exhausted" as const;
  readonly attemptedModels: readonly string[];
  readonly hadIncompleteResponse: boolean;
  readonly lastAttemptIncomplete: boolean;
  readonly lastError?: unknown;

  constructor(
    attemptedModels: readonly string[],
    hadIncompleteResponse: boolean,
    lastAttemptIncomplete: boolean,
    lastError?: unknown,
  ) {
    super("No Ads campaign strategist returned a complete plan.");
    this.name = "AdsCampaignModelChainError";
    this.attemptedModels = attemptedModels;
    this.hadIncompleteResponse = hadIncompleteResponse;
    this.lastAttemptIncomplete = lastAttemptIncomplete;
    this.lastError = lastError;
  }
}

/** A parseable yet unusable plan is a failed model attempt, not success. */
export async function generateAdsCampaignWithFallback<TRaw, TPlan>(args: {
  generate: (model: string, index: number, qualityRepair?: boolean) => Promise<TRaw>;
  validate: (raw: TRaw, model: string) => TPlan | null;
  onAttempt?: (model: string, index: number, qualityRepair?: boolean) => void;
  /** One editorial repair on the primary model, only after a parsed plan fails review. */
  canRepairPrimary?: () => boolean;
  shouldRetry?: (error: unknown) => boolean;
}): Promise<{ plan: TPlan; model: string; attemptedModels: string[] }> {
  const attemptedModels: string[] = [];
  let hadIncompleteResponse = false;
  let lastAttemptIncomplete = false;
  let lastError: unknown;

  for (const [index, model] of ADS_CAMPAIGN_MODEL_CHAIN.entries()) {
    if (attemptedModels.length >= ADS_CAMPAIGN_MAX_ATTEMPTS) break;
    attemptedModels.push(model);
    args.onAttempt?.(model, index);
    try {
      const raw = await args.generate(model, index);
      const plan = args.validate(raw, model);
      if (plan !== null) return { plan, model, attemptedModels };
      hadIncompleteResponse = true;
      lastAttemptIncomplete = true;
      if (index === 0 && attemptedModels.length < ADS_CAMPAIGN_MAX_ATTEMPTS && args.canRepairPrimary?.()) {
        attemptedModels.push(model);
        args.onAttempt?.(model, index, true);
        const repairedRaw = await args.generate(model, index, true);
        const repairedPlan = args.validate(repairedRaw, model);
        if (repairedPlan !== null) return { plan: repairedPlan, model, attemptedModels };
      }
    } catch (error) {
      lastError = error;
      lastAttemptIncomplete = false;
      if (args.shouldRetry && !args.shouldRetry(error)) break;
    }
  }

  throw new AdsCampaignModelChainError(
    attemptedModels, hadIncompleteResponse, lastAttemptIncomplete, lastError,
  );
}
