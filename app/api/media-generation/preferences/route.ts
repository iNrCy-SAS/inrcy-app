import { NextResponse } from "next/server";

import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import {
  AiMediaGeneratorPreferencesValidationError,
  AiMediaGeneratorPreferencesVersionError,
  normalizeAiMediaGeneratorPreferences,
  parseAiMediaGeneratorPreferencesPatch,
} from "@/lib/aiMediaGenerationPreferences";
import { withApi } from "@/lib/observability/withApi";
import { requireUser } from "@/lib/requireUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

type SupabaseRpcError = {
  code?: string | null;
  message?: string | null;
};

function withNoStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
  const vary = response.headers.get("Vary");
  if (!vary) {
    response.headers.set("Vary", "Cookie");
  } else if (!vary.toLowerCase().split(/\s*,\s*/).includes("cookie")) {
    response.headers.set("Vary", `${vary}, Cookie`);
  }
  return response;
}

function jsonNoStore(
  body: unknown,
  init: ResponseInit = {},
) {
  return withNoStore(NextResponse.json(body, init));
}

function errorText(error: SupabaseRpcError): string {
  return `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
}

function isMissingAtomicPatchMigration(error: SupabaseRpcError): boolean {
  const message = errorText(error);
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    message.includes("inrcy_patch_ai_media_generator_preferences")
  );
}

function isFuturePreferencesVersionError(error: SupabaseRpcError): boolean {
  return errorText(error).includes(
    "ai_media_preferences_version_unsupported",
  );
}

function isInvalidStoredPreferencesError(error: SupabaseRpcError): boolean {
  return errorText(error).includes("ai_media_preferences_settings_invalid");
}

function isInvalidPreferencesPatchError(error: SupabaseRpcError): boolean {
  return errorText(error).includes("ai_media_preferences_invalid_patch");
}

function futureVersionResponse(error?: AiMediaGeneratorPreferencesVersionError) {
  return jsonNoStore(
    {
      ok: false,
      code: "AI_MEDIA_PREFERENCES_VERSION_UNSUPPORTED",
      error:
        error?.message ??
        "Ces réglages média ont été enregistrés par une version plus récente de l’application. Rechargez la page avant de les modifier.",
    },
    { status: 409 },
  );
}

function invalidPatchResponse(message: string) {
  return jsonNoStore(
    {
      ok: false,
      code: "AI_MEDIA_PREFERENCES_INVALID",
      error: message,
    },
    { status: 400 },
  );
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function getMediaGenerationPreferences() {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return withNoStore(errorResponse);

  const { data, error } = await supabase
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (error) {
    return withNoStore(jsonUserFacingError(error, { status: 500 }));
  }

  const rootSettings = safeObject(data?.settings);
  let preferences;
  try {
    preferences = normalizeAiMediaGeneratorPreferences(
      rootSettings.ai_media_generator,
    );
  } catch (error) {
    if (error instanceof AiMediaGeneratorPreferencesVersionError) {
      return futureVersionResponse(error);
    }
    throw error;
  }

  return jsonNoStore({ ok: true, preferences });
}

async function patchMediaGenerationPreferences(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return withNoStore(errorResponse);

  const body = await req.json().catch(() => null);
  let patch;

  try {
    patch = parseAiMediaGeneratorPreferencesPatch(body);
  } catch (error) {
    if (error instanceof AiMediaGeneratorPreferencesValidationError) {
      return invalidPatchResponse(error.message);
    }
    throw error;
  }

  const { data, error } = await supabase.rpc(
    "inrcy_patch_ai_media_generator_preferences",
    {
      p_account_id: activeUserId,
      p_block_id: patch.blockId,
      p_saved: patch.saved,
      p_defaults: patch.defaults ?? {},
    },
  );

  if (error) {
    if (isMissingAtomicPatchMigration(error)) {
      return jsonNoStore(
        {
          ok: false,
          code: "AI_MEDIA_PREFERENCES_MIGRATION_REQUIRED",
          error:
            "La sauvegarde des réglages média est momentanément indisponible pendant la mise à jour.",
        },
        { status: 503 },
      );
    }
    if (isFuturePreferencesVersionError(error)) {
      return futureVersionResponse();
    }
    if (isInvalidStoredPreferencesError(error)) {
      return jsonNoStore(
        {
          ok: false,
          code: "AI_MEDIA_PREFERENCES_SETTINGS_INVALID",
          error:
            "Les réglages média enregistrés ne peuvent pas être modifiés sans vérification. Aucune donnée n’a été écrasée.",
        },
        { status: 409 },
      );
    }
    if (isInvalidPreferencesPatchError(error)) {
      return invalidPatchResponse("Les réglages média envoyés sont invalides.");
    }
    return withNoStore(jsonUserFacingError(error, { status: 500 }));
  }

  try {
    const preferences = normalizeAiMediaGeneratorPreferences(data);
    return jsonNoStore({ ok: true, preferences });
  } catch (error) {
    if (error instanceof AiMediaGeneratorPreferencesVersionError) {
      return futureVersionResponse(error);
    }
    throw error;
  }
}

export const GET = withApi(
  async () => getMediaGenerationPreferences(),
  { route: "/api/media-generation/preferences" },
);

export const PATCH = withApi(patchMediaGenerationPreferences, {
  route: "/api/media-generation/preferences",
});
