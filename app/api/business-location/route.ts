import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { validateBusinessLocation } from "@/lib/businessLocationAutofill";
import { autofillBusinessLocation, readBusinessLocation, saveBusinessLocation } from "@/lib/businessLocationServer";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireUser } from "@/lib/requireUser";
import { asRecord } from "@/lib/tsSafe";

export const runtime = "nodejs";
export const maxDuration = 60;

function accountMismatch(requested: unknown, active: string) {
  return requested !== undefined && requested !== null && requested !== active;
}

function forbidden() {
  return NextResponse.json({ ok: false, error: "Ce compte n’est pas le compte actif." }, { status: 403 });
}

function result(accountId: string, location: { postalCode: string; city: string }, source?: string) {
  return NextResponse.json({ ok: true, accountId, location, ...(source ? { source } : {}) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(req: Request) {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  const requested = new URL(req.url).searchParams.get("accountId");
  if (accountMismatch(requested, activeUserId)) return forbidden();
  try { return result(activeUserId, await readBusinessLocation(supabase, activeUserId)); }
  catch (error) { return jsonUserFacingError(error, { status: 500 }); }
}

export async function PUT(req: Request) {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  let payload: Record<string, unknown>;
  try { payload = asRecord(await req.json()); }
  catch { return NextResponse.json({ ok: false, error: "La demande est invalide." }, { status: 400 }); }
  if (accountMismatch(payload.accountId, activeUserId)) return forbidden();
  const location = validateBusinessLocation(payload);
  if (!location) return NextResponse.json({ ok: false, error: "Vérifiez le code postal et la ville saisis." }, { status: 400 });
  try { return result(activeUserId, await saveBusinessLocation(supabase, activeUserId, location)); }
  catch (error) { return jsonUserFacingError(error, { status: 500 }); }
}

export async function POST(req: Request) {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  let payload: Record<string, unknown>;
  try { payload = asRecord(await req.json()); }
  catch { return NextResponse.json({ ok: false, error: "La demande est invalide." }, { status: 400 }); }
  if (accountMismatch(payload.accountId, activeUserId)) return forbidden();
  if (payload.action !== "autofill") return NextResponse.json({ ok: false, error: "Action invalide." }, { status: 400 });
  const limited = await enforceRateLimit({
    name: "business-location-autofill", identifier: activeUserId, limit: 5, window: "5 m",
  });
  if (limited) return limited;
  try {
    const saved = await autofillBusinessLocation({ supabase, accountId: activeUserId });
    return result(activeUserId, saved.location, saved.source);
  } catch (error) { return jsonUserFacingError(error, { status: 500 }); }
}
