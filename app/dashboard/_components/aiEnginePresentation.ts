import type { AiPreferredEngine } from "@/lib/aiEnginePreference";

export function getAiEnginePresentation(i18nT: (key: string) => string, engine: AiPreferredEngine) {
  switch (engine) {
    case "anthropic": return { tendency: i18nT("engine_anthropic_tendency"), bestFor: i18nT("engine_anthropic_best_for") };
    case "google": return { tendency: i18nT("engine_google_tendency"), bestFor: i18nT("engine_google_best_for") };
    case "mistral": return { tendency: i18nT("engine_mistral_tendency"), bestFor: i18nT("engine_mistral_best_for") };
    case "xai": return { tendency: i18nT("engine_xai_tendency"), bestFor: i18nT("engine_xai_best_for") };
    case "perplexity": return { tendency: i18nT("engine_perplexity_tendency"), bestFor: i18nT("engine_perplexity_best_for") };
    case "deepseek": return { tendency: i18nT("engine_deepseek_tendency"), bestFor: i18nT("engine_deepseek_best_for") };
    case "meta": return { tendency: i18nT("engine_meta_tendency"), bestFor: i18nT("engine_meta_best_for") };
    default: return { tendency: i18nT("engine_openai_tendency"), bestFor: i18nT("engine_openai_best_for") };
  }
}
