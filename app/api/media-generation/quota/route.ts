import { NextResponse } from "next/server";

import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import {
  AiMediaGenerationQuotaError,
  getAiMediaQuotaSnapshot,
} from "@/lib/aiMediaGenerationQuota";
import { getCurrentInrcyAccountScope } from "@/lib/multicompte/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  try {
    const current = await getCurrentInrcyAccountScope();
    if (!current) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", error: "Non authentifié." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const { authUserId, activeUserId } = current.scope;
    const edition = await getDashboardEditionForAccountId(activeUserId);
    const quota = await getAiMediaQuotaSnapshot({
      accountId: activeUserId,
      actorAuthUserId: authUserId,
      edition,
    });

    return NextResponse.json(
      { ok: true, quota },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof AiMediaGenerationQuotaError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.httpStatus, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[ai-media] quota snapshot failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        ok: false,
        code: "AI_MEDIA_QUOTA_UNAVAILABLE",
        error: "Les plafonds de génération sont momentanément indisponibles.",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
