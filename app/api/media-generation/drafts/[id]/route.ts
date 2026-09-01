import { NextResponse } from "next/server";

import { discardGeneratedAiMediaDraft } from "@/lib/aiGeneratedMediaRegistry";
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

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) return jsonError(401, "UNAUTHORIZED", "Non authentifié.");

    const { id: rawId } = await context.params;
    const mediaId = String(rawId || "").trim();
    // DELETE est idempotent : un identifiant absent ou déjà purgé est un succès.
    if (!UUID_PATTERN.test(mediaId)) {
      return NextResponse.json(
        { ok: true, discarded: false },
        { headers: NO_STORE_HEADERS },
      );
    }

    const accountId = current.scope.activeUserId;
    const rateLimited = await enforceRateLimit({
      name: "ai_media_draft_discard",
      identifier: accountId,
      limit: 80,
      fallbackLimit: 30,
      window: "10 m",
      failClosed: true,
      code: "ai_media_draft_discard_burst",
    });
    if (rateLimited) return rateLimited;

    const outcome = await discardGeneratedAiMediaDraft({ accountId, mediaId });
    return NextResponse.json(
      {
        ok: true,
        discarded: outcome === "discarded" || outcome === "missing",
        accepted: outcome === "accepted",
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[ai-media] draft discard failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      500,
      "AI_MEDIA_DRAFT_DISCARD_FAILED",
      "Le brouillon n’a pas pu être supprimé immédiatement.",
    );
  }
}
