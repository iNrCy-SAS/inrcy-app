// L'ADN produit un JSON approfondi sans streaming. Les trois transports doivent
// partager la même deadline, avec assez de temps pour les secours existants.
export const BUSINESS_DNA_OPERATION_MAX_DURATION_MS = 240_000;
export const BUSINESS_DNA_PRIMARY_TIMEOUT_MS = 130_000;
export const BUSINESS_DNA_COMPLETION_LATEST_START_MS = 170_000;
export const BUSINESS_DNA_AUTOMATIC_REQUEST_TIMEOUT_MS = 345_000;
export const BUSINESS_DNA_AUTOMATIC_LEASE_SECONDS = 450;

export function resolveBusinessDnaStageTimeoutMs(args: {
  stage: "primary" | "gateway_model" | "openai_direct";
  hardDeadlineAt: number;
  requestedTimeoutMs: number;
  gatewayFallbackAvailable: boolean;
  directFallbackAvailable: boolean;
  now?: number;
}) {
  const remaining = args.hardDeadlineAt - (args.now ?? Date.now());
  // Même marge de finalisation que la couche commune ; aucun minimum artificiel
  // ne doit prolonger un appel au-delà de la deadline de l'opération.
  if (remaining <= 5_750) return 0;
  const reserve = args.stage === "primary"
    ? (args.gatewayFallbackAvailable ? 60_000 : 0) + (args.directFallbackAvailable ? 40_000 : 0)
    : args.stage === "gateway_model" && args.directFallbackAvailable ? 40_000 : 0;
  const stageLimit = args.stage === "primary" ? 130_000
    : args.stage === "gateway_model" ? 60_000 : 40_000;
  return Math.max(5_000, Math.min(
    args.requestedTimeoutMs,
    stageLimit,
    remaining - Math.min(reserve, Math.floor(remaining * 0.6)) - 750,
  ));
}
