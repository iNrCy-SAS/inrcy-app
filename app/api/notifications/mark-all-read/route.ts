import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(req?: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = req ? await req.json().catch(() => ({})) : {};
  const ids = body.notificationIds;
  if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)))) return NextResponse.json({ error: "Identifiants de notification invalides." }, { status: 400 });
  let query = supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", activeUserId).is("read_at", null);
  if (ids) query = query.in("id", ids);
  const { error } = await query;

  if (error) return jsonUserFacingError(error, { status: 500 });
  return NextResponse.json({ ok: true });
}
