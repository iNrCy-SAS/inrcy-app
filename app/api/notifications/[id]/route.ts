import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NOTIFICATION_REMOVAL_FIELDS, NOTIFICATION_REMOVAL_SELECT, notificationRemovalFingerprint } from "@/lib/notificationRemovalState";

export const runtime = "nodejs";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { errorResponse, activeUserId, authUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const { id } = await ctx.params;
  const payload: unknown = request.body ? await request.json().catch(() => null) : undefined;
  const guard = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const guarded = payload !== undefined;
  const conflict = () => NextResponse.json({ error: "La notification ou le compte a changé. Renouvelez l’aperçu.", code: "notification_scope_or_state_changed" }, { status: 409 });
  if (request.signal.aborted) return conflict();
  if (guarded && (!guard || Object.keys(guard).length !== 3 || ![guard.expectedAccountId, guard.expectedActorUserId].every(value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))
    || guard.expectedAccountId !== activeUserId || guard.expectedActorUserId !== authUserId || typeof guard.expectedFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(guard.expectedFingerprint))) return conflict();
  let expected: Record<string, unknown> | null = null;
  if (guarded) {
    const current = await supabaseAdmin.from("notifications").select(NOTIFICATION_REMOVAL_SELECT).eq("id", id).eq("user_id", activeUserId).maybeSingle();
    if (current.error) return jsonUserFacingError(current.error, { status: 500 });
    if (!current.data || notificationRemovalFingerprint(current.data) !== guard!.expectedFingerprint) return conflict();
    expected = current.data;
  }

  if (request.signal.aborted) return conflict();
  let deletion = supabaseAdmin
    .from("notifications")
    .delete()
    .eq("id", id)
    .eq("user_id", activeUserId);
  if (expected) {
    for (const field of NOTIFICATION_REMOVAL_FIELDS.filter(field => field !== "id" && field !== "user_id")) {
      const value = expected[field] ?? null;
      deletion = value === null ? deletion.is(field, null) : deletion.eq(field, typeof value === "object" ? JSON.stringify(value) : value);
    }
    const result = await deletion.select("id").maybeSingle();
    if (result.error) return jsonUserFacingError(result.error, { status: 500 });
    if (result.data?.id !== id) return conflict();
    return NextResponse.json({ ok: true });
  }
  const { error } = await deletion;

  if (error) return jsonUserFacingError(error, { status: 500 });
  return NextResponse.json({ ok: true });
}
