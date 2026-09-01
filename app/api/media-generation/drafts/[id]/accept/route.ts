import { NextResponse } from "next/server";

import { acceptGeneratedAiMediaDraft } from "@/lib/aiGeneratedMediaRegistry";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(status: number, code: string, error: string) {
  return NextResponse.json(
    { ok: false, code, error },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return jsonError(401, "UNAUTHORIZED", "Non authentifié.");

    const { id: rawId } = await context.params;
    const mediaId = String(rawId || "").trim();
    if (!UUID_PATTERN.test(mediaId)) {
      return jsonError(404, "AI_MEDIA_DRAFT_NOT_FOUND", "Brouillon introuvable.");
    }

    const accountId = current.scope.activeUserId;
    const rateLimited = await enforceRateLimit({
      name: "ai_media_draft_accept",
      identifier: accountId,
      limit: 40,
      fallbackLimit: 20,
      window: "10 m",
      failClosed: true,
      code: "ai_media_draft_accept_burst",
    });
    if (rateLimited) return rateLimited;

    const item = await acceptGeneratedAiMediaDraft({
      accountId,
      authUserId: current.scope.authUserId,
      mediaId,
    });
    if (!item) {
      return jsonError(404, "AI_MEDIA_DRAFT_NOT_FOUND", "Brouillon introuvable.");
    }

    return NextResponse.json({ ok: true, item }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[ai-media] draft acceptance failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      500,
      "AI_MEDIA_DRAFT_ACCEPT_FAILED",
      "Le média n’a pas pu être enregistré dans la Médiathèque.",
    );
  }
}
