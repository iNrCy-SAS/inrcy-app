import { NextResponse } from "next/server";

import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import {
  normalizeInstagramPublicationPreferences,
  parseInstagramPublicationPreferencesPatch,
} from "@/lib/instagramPublicationPreferences";
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

function isMissingAtomicRpc(error: { code?: string | null }) {
  return error.code === "PGRST202";
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
  const instagram = asRecord(root.instagram);
  return jsonNoStore({
    ok: true,
    preferences: normalizeInstagramPublicationPreferences(
      instagram.publicationPreferences,
    ),
  });
}

async function patchPreferences(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await req.json().catch(() => null);
  let preferences;
  try {
    preferences = parseInstagramPublicationPreferencesPatch(body);
  } catch (error) {
    return jsonNoStore(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Les formats Instagram envoyés sont invalides.",
      },
      { status: 400 },
    );
  }

  const { data: atomicData, error: atomicError } = await supabase.rpc(
    "inrcy_set_instagram_publication_preferences",
    {
      p_account_id: activeUserId,
      p_preferences: preferences,
    },
  );

  if (!atomicError) {
    return jsonNoStore({
      ok: true,
      preferences: normalizeInstagramPublicationPreferences(atomicData),
    });
  }

  if (!isMissingAtomicRpc(atomicError)) {
    return jsonUserFacingError(atomicError, { status: 500 });
  }

  return jsonNoStore(
    {
      ok: false,
      code: "INSTAGRAM_PUBLICATION_PREFERENCES_MIGRATION_REQUIRED",
      error:
        "La mise à jour sécurisée des préférences Instagram doit être appliquée avant d’enregistrer ces réglages. Aucun réglage n’a été modifié.",
    },
    { status: 503 },
  );
}

export const GET = withApi(getPreferences, {
  route: "/api/integrations/instagram/publication-preferences",
});

export const PATCH = withApi(patchPreferences, {
  route: "/api/integrations/instagram/publication-preferences",
});
