import { NextResponse } from "next/server";

import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import {
  normalizeFacebookPublicationPreferences,
  parseFacebookPublicationPreferencesPatch,
} from "@/lib/facebookPublicationPreferences";
import { withApi } from "@/lib/observability/withApi";
import { requireUser } from "@/lib/requireUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonNoStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

async function getPreferences() {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { data, error } = await supabase
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", activeUserId)
    .maybeSingle();
  if (error) return jsonUserFacingError(error, { status: 500 });

  const root = asRecord(data?.settings);
  const facebook = asRecord(root.facebook);
  return jsonNoStore({
    ok: true,
    preferences: normalizeFacebookPublicationPreferences(
      facebook.publicationPreferences,
    ),
  });
}

async function patchPreferences(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await req.json().catch(() => null);
  let preferences;
  try {
    preferences = parseFacebookPublicationPreferencesPatch(body);
  } catch (error) {
    return jsonNoStore(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Les formats Facebook envoyés sont invalides.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc(
    "inrcy_set_facebook_publication_preferences",
    { p_account_id: activeUserId, p_preferences: preferences },
  );
  if (error) {
    if (error.code === "PGRST202") {
      return jsonNoStore(
        {
          ok: false,
          code: "FACEBOOK_PUBLICATION_PREFERENCES_MIGRATION_REQUIRED",
          error:
            "La mise à jour sécurisée des préférences Facebook doit être appliquée avant d’enregistrer ces réglages. Aucun réglage n’a été modifié.",
        },
        { status: 503 },
      );
    }
    return jsonUserFacingError(error, { status: 500 });
  }

  return jsonNoStore({
    ok: true,
    preferences: normalizeFacebookPublicationPreferences(data),
  });
}

export const GET = withApi(getPreferences, {
  route: "/api/integrations/facebook/publication-preferences",
});
export const PATCH = withApi(patchPreferences, {
  route: "/api/integrations/facebook/publication-preferences",
});
