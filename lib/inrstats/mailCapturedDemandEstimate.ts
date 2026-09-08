type MailCapturedDemandInput = {
  campaigns: number;
  recipients: number;
  leadConversionRate: number;
};

export const MAIL_CAPTURED_MODEL_VERSION = "mail_captured_v1";

const DEFAULT_LEAD_CONVERSION_RATE = 5;
const MAIL_ATTRIBUTION_FACTOR = 0.08;
const MIN_MAIL_CONVERSION_RATE = 0.25;
const MAX_MAIL_CONVERSION_RATE = 1.5;

function nonNegativeInt(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Conservative attribution model used until a provider exposes replies and
 * conversions directly. Recipients are the measured base, the professional's
 * configured lead-conversion rate is reduced to 8% of its value and capped at
 * 1.5%, then a campaign-volume confidence factor is applied. Math.floor keeps
 * the result deliberately pessimistic and prevents presenting weak signals as
 * measured campaign returns.
 */
export function estimateMailCapturedDemands(input: MailCapturedDemandInput) {
  const campaigns = nonNegativeInt(input.campaigns);
  const recipients = nonNegativeInt(input.recipients);
  if (campaigns === 0 || recipients === 0) return 0;

  const configuredRate = Number(input.leadConversionRate);
  const profileRate = Number.isFinite(configuredRate) && configuredRate > 0
    ? configuredRate
    : DEFAULT_LEAD_CONVERSION_RATE;
  const pessimisticMailRate = clamp(
    profileRate * MAIL_ATTRIBUTION_FACTOR,
    MIN_MAIL_CONVERSION_RATE,
    MAX_MAIL_CONVERSION_RATE,
  );
  const campaignConfidence = clamp(0.5 + campaigns * 0.1, 0.6, 1);

  return Math.max(0, Math.floor(recipients * (pessimisticMailRate / 100) * campaignConfidence));
}
