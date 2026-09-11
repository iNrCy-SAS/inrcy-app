import { NextResponse } from "next/server";

import {
  defaultBusinessDnaAutomaticSchedule,
  isValidBusinessDnaScheduleTimezone,
  normalizeBusinessDnaAutomaticScheduleRow,
  normalizeBusinessDnaScheduleTimezone,
} from "@/lib/businessDnaAutomaticSchedule";
import { requireUser } from "@/lib/requireUser";

export const runtime = "nodejs";
export const maxDuration = 20;

const SCHEDULE_SELECT =
  "enabled,day_of_month,run_time,timezone,next_run_at,last_status,last_run_at,last_success_at,last_run_period";

function noStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

function isMissingScheduleSchema(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const text = [candidate?.code, candidate?.message, candidate?.details]
    .map((value) => String(value || ""))
    .join(" ");
  return /42P01|PGRST205|business_dna_analysis_schedules/i.test(text);
}

function scheduleError(error: unknown) {
  if (isMissingScheduleSchema(error)) {
    return noStore(
      {
        error: "La programmation automatique doit d’abord être activée dans Supabase.",
        user_message: "La programmation automatique doit d’abord être activée dans Supabase.",
        error_code: "business_dna_schedule_migration_required",
      },
      503,
    );
  }
  console.error("[business-dna-schedule] request failed", error);
  return noStore(
    {
      error: "La programmation de l’analyse est momentanément indisponible.",
      user_message: "La programmation de l’analyse est momentanément indisponible.",
      error_code: "business_dna_schedule_unavailable",
    },
    500,
  );
}

function isCrossSiteMutation(request: Request) {
  return String(request.headers.get("sec-fetch-site") || "").toLowerCase() === "cross-site";
}

async function getProfileTimezone(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  accountId: string,
) {
  const { data, error } = await supabase
    .from("business_profiles")
    .select("timezone")
    .eq("user_id", accountId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const message = String(error.message || "");
    if (!/timezone|42703/i.test(message)) throw error;
  }
  const timezone = String(data?.timezone || "").trim();
  return isValidBusinessDnaScheduleTimezone(timezone)
    ? timezone
    : normalizeBusinessDnaScheduleTimezone(null);
}

export async function GET() {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  try {
    const [timezone, scheduleResult] = await Promise.all([
      getProfileTimezone(supabase, activeUserId),
      supabase
        .from("business_dna_analysis_schedules")
        .select(SCHEDULE_SELECT)
        .eq("account_id", activeUserId)
        .maybeSingle(),
    ]);
    if (scheduleResult.error) return scheduleError(scheduleResult.error);

    const schedule = scheduleResult.data
      ? normalizeBusinessDnaAutomaticScheduleRow(scheduleResult.data, timezone)
      : defaultBusinessDnaAutomaticSchedule(timezone);
    return noStore({ ok: true, schedule });
  } catch (error) {
    return scheduleError(error);
  }
}

export async function PUT(request: Request) {
  if (isCrossSiteMutation(request)) {
    return noStore(
      {
        error: "Requête refusée.",
        user_message: "Requête refusée.",
        error_code: "cross_site_request_rejected",
      },
      403,
    );
  }

  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const rawBody = await request.text();
  if (rawBody.length > 4_000) {
    return noStore(
      { error: "Configuration trop volumineuse.", error_code: "payload_too_large" },
      413,
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody || "{}");
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return noStore(
      { error: "Configuration invalide.", error_code: "invalid_json" },
      400,
    );
  }

  if (typeof body.enabled !== "boolean") {
    return noStore(
      { error: "L’état de la programmation est invalide.", error_code: "invalid_enabled" },
      400,
    );
  }
  const dayOfMonth = Number(body.dayOfMonth);
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
    return noStore(
      { error: "Le jour doit être compris entre 1 et 28.", error_code: "invalid_day" },
      400,
    );
  }
  const time = String(body.time || "").trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return noStore(
      { error: "L’heure de programmation est invalide.", error_code: "invalid_time" },
      400,
    );
  }

  try {
    const timezone = await getProfileTimezone(supabase, activeUserId);

    const { data, error } = await supabase.rpc(
      "upsert_business_dna_analysis_schedule",
      {
        p_account_id: activeUserId,
        p_enabled: body.enabled,
        p_day_of_month: dayOfMonth,
        p_run_time: time,
        p_timezone: timezone,
      },
    );
    if (error) return scheduleError(error);

    const savedRow = Array.isArray(data) ? data[0] : data;
    if (!savedRow) {
      return scheduleError(new Error("business_dna_analysis_schedules: empty RPC response"));
    }

    return noStore({
      ok: true,
      schedule: normalizeBusinessDnaAutomaticScheduleRow(savedRow, timezone),
    });
  } catch (error) {
    return scheduleError(error);
  }
}
