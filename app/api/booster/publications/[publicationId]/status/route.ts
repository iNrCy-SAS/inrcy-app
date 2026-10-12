import { projectInstagramDeletionStatus } from "@/lib/inrsend/instagramDeletionStatus";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { readAsyncPublicationStatus } from "@/lib/boosterAsyncPublication";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handler(
  _request: Request,
  context: { params: Promise<{ publicationId: string }> },
) {
  try {
    const { errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const { publicationId: rawPublicationId } = await context.params;
    const publicationId = String(rawPublicationId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(publicationId)) {
      return NextResponse.json(
        { ok: false, code: "invalid_publication_id", error: "Publication invalide." },
        { status: 400 },
      );
    }

    const status = await readAsyncPublicationStatus({
      userId: activeUserId,
      publicationId,
    });
    if (!status) {
      return NextResponse.json(
        { ok: false, code: "publication_not_found", error: "Publication introuvable." },
        { status: 404 },
      );
    }

    return NextResponse.json(projectInstagramDeletionStatus(status), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonUserFacingError(error, {
      status: 500,
      code: "publication_status_failed",
      fallback: "Impossible de vérifier la publication pour le moment.",
    });
  }
}

export const GET = handler;
