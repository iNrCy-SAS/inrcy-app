import "server-only";

import {
  normalizeAiMediaGeneratorPreferences,
  type AiMediaGeneratorPreferences,
} from "@/lib/aiMediaGenerationPreferences";
type SupabaseQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data?: { settings?: unknown } | null;
          error?: { code?: string | null; message?: string | null } | null;
        }>;
      };
    };
  };
};

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Charge les réglages iNrStudio sans jamais bloquer la publication iNrAgent.
 * Une absence de ligne ou une migration momentanément indisponible retombe
 * sur les valeurs neutres déjà définies par le contrat Studio.
 */
export async function loadInrAgentStudioMediaPreferences(args: {
  supabase: unknown;
  accountId: string;
}): Promise<AiMediaGeneratorPreferences | null> {
  try {
    const { data, error } = await (args.supabase as SupabaseQueryClient)
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", args.accountId)
      .maybeSingle();
    if (error) {
      console.warn("[inr-agent] studio media preferences unavailable", {
        code: error.code || null,
      });
      return null;
    }
    const settings = safeObject(data?.settings);
    return normalizeAiMediaGeneratorPreferences(settings.ai_media_generator);
  } catch (error) {
    console.warn("[inr-agent] studio media preferences could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
