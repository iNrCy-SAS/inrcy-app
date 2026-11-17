import type { LogWarningsFunction } from "ai";

const ALLOWED_WARNING_TYPES = new Set(["unsupported", "compatibility", "other"]);
export type SafeAiSdkWarningsSummary = { count: number; types: string[] };

/** Supplier messages, features, URLs, model labels and request data are excluded. */
export function summarizeAiSdkWarnings(value: unknown): SafeAiSdkWarningsSummary {
  const warnings = value && typeof value === "object" && "warnings" in value && Array.isArray(value.warnings) ? value.warnings : [];
  const types = new Set<string>();
  for (const warning of warnings.slice(0,100)) {
    if (warning && typeof warning === "object" && "type" in warning &&
        typeof warning.type === "string" && ALLOWED_WARNING_TYPES.has(warning.type)) types.add(warning.type);
  }
  return { count: Math.min(warnings.length,1_000_000), types: [...types].sort() };
}

export const safeAiSdkWarningLogger: LogWarningsFunction = (options) => {
  const summary = summarizeAiSdkWarnings(options);
  if (!summary.count) return;
  try { console.warn("[ai-sdk] provider warnings", summary); } catch { /* Diagnostics must not fail generation. */ }
};

/** One persistent server policy; never swap or restore the logger per request. */
export function installSafeAiSdkWarningLogger(): void {
  globalThis.AI_SDK_LOG_WARNINGS = safeAiSdkWarningLogger;
}
