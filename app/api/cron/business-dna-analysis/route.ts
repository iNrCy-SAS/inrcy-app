import { NextResponse } from "next/server";

import {
  buildInternalCronHeaders,
  getAppOriginFromRequest,
  isAuthorizedCronRequest,
} from "@/lib/cronAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 180;

type ClaimedSchedule = {
  account_id?: unknown;
  lock_token?: unknown;
  scheduled_period_start?: unknown;
  scheduled_for?: unknown;
  attempt_count?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function schemaMissing(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  return /42P01|42883|PGRST202|business_dna_(?:analysis_schedules|automatic_analysis)/i.test(
    [candidate?.code, candidate?.message, candidate?.details]
      .map((value) => String(value || ""))
      .join(" "),
  );
}

async function completeClaim(args: {
  accountId: string;
  lockToken: string;
  outcome: "success" | "no_source" | "failed";
  errorCode?: string | null;
}) {
  const { data, error } = await supabaseAdmin.rpc(
    "complete_business_dna_automatic_analysis",
    {
      p_account_id: args.accountId,
      p_lock_token: args.lockToken,
      p_outcome: args.outcome,
      p_error_code: args.errorCode || null,
    },
  );
  if (error) throw error;
  return String(data || "completed");
}

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Non autorisé." }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc(
    "claim_due_business_dna_automatic_analysis",
    { p_lease_seconds: 180 },
  );
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        migrationRequired: schemaMissing(error),
        error: schemaMissing(error)
          ? "La migration de programmation ADN doit être appliquée."
          : error.message,
      },
      { status: 503 },
    );
  }

  const claim = (Array.isArray(data) ? data[0] : data) as ClaimedSchedule | null;
  const accountId = String(claim?.account_id || "").trim();
  const lockToken = String(claim?.lock_token || "").trim();
  if (!accountId || !lockToken) {
    return NextResponse.json({ ok: true, claimed: false, processed: 0 });
  }

  let outcome: "success" | "no_source" | "failed" = "failed";
  let errorCode: string | null = null;
  let responseStatus = 500;
  try {
    const origin = getAppOriginFromRequest(request);
    const response = await fetch(`${origin}/api/ai-memory/analyze-channels?automatic=1`, {
      method: "POST",
      headers: buildInternalCronHeaders(accountId),
      cache: "no-store",
      signal: AbortSignal.timeout(115_000),
    });
    responseStatus = response.status;
    const payload = asRecord(await response.json().catch(() => ({})));
    errorCode = typeof payload.error_code === "string" ? payload.error_code : null;
    if (response.ok && payload.ok === true) {
      outcome = "success";
    } else if (errorCode === "business_dna_no_readable_source") {
      outcome = "no_source";
    }
  } catch (analysisError) {
    errorCode = analysisError instanceof Error && analysisError.name === "TimeoutError"
      ? "business_dna_automatic_timeout"
      : "business_dna_automatic_request_failed";
    console.error("[business-dna-automatic] analysis request failed", {
      accountId,
      errorCode,
      message: analysisError instanceof Error ? analysisError.message : String(analysisError),
    });
  }

  try {
    const completion = await completeClaim({ accountId, lockToken, outcome, errorCode });
    if (outcome === "failed") {
      console.error("[business-dna-automatic] analysis failed", {
        accountId,
        responseStatus,
        errorCode,
        completion,
      });
    }
    return NextResponse.json({
      ok: true,
      claimed: true,
      processed: 1,
      accountId,
      scheduledPeriod: claim?.scheduled_period_start || null,
      scheduledFor: claim?.scheduled_for || null,
      attempt: Number(claim?.attempt_count || 1),
      outcome,
      completion,
      errorCode,
    });
  } catch (completionError) {
    console.error("[business-dna-automatic] completion failed", {
      accountId,
      message: completionError instanceof Error
        ? completionError.message
        : String(completionError),
    });
    return NextResponse.json(
      { ok: false, claimed: true, accountId, outcome, error: "Finalisation impossible." },
      { status: 500 },
    );
  }
}

export const GET = POST;
