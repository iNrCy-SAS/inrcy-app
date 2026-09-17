import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  normalizeBoosterGenerationRequestId,
  readBoosterGenerationRecoveryPayload,
} from "@/lib/boosterGenerationRecovery";
import { withApi } from "@/lib/observability/withApi";
import { log } from "@/lib/observability/logger";

export const runtime = "nodejs";

function noStoreJson(
  body: Record<string, unknown>,
  init?: { status?: number },
) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

const handler = async (request: Request) => {
  const { authUserId, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const limited = await enforceRateLimit({
    name: "booster_generation_result",
    identifier: authUserId,
    limit: 90,
    fallbackLimit: 90,
    window: "2 m",
    failClosed: false,
  });
  if (limited) return limited;

  const url = new URL(request.url);
  const workspaceId = String(url.searchParams.get("workspaceId") || "")
    .trim()
    .slice(0, 80);
  const generationRequestId = normalizeBoosterGenerationRequestId(
    url.searchParams.get("requestId"),
  );
  if (!workspaceId || !generationRequestId) {
    return noStoreJson(
      {
        ok: false,
        code: "invalid_generation_recovery_request",
        error: "Reçu de génération invalide.",
      },
      { status: 400 },
    );
  }

  const result = await supabaseAdmin
    .from("publication_workspaces")
    .select("generated_content")
    .eq("id", workspaceId)
    .eq("account_id", activeUserId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    return noStoreJson(
      {
        ok: false,
        code: "generation_workspace_not_found",
        error: "Espace de génération introuvable.",
      },
      { status: 404 },
    );
  }

  const recovery = readBoosterGenerationRecoveryPayload(
    result.data.generated_content,
    generationRequestId,
  );
  if (!recovery) {
    return noStoreJson(
      {
        ok: true,
        status: "pending",
        generationRequestId,
      },
      { status: 202 },
    );
  }

  log.info("booster_generation_result_recovered", {
    route: "/api/booster/generation-result",
    workspace_id: workspaceId,
    generation_request_id: generationRequestId,
    generated_at: recovery.generatedAt || null,
    channel_count: Object.keys(recovery.versions).length,
  });

  return noStoreJson({
    ok: true,
    status: "ready",
    ...recovery,
  });
};

export const GET = withApi(handler, {
  route: "/api/booster/generation-result",
});
