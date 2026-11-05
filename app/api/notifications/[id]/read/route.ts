import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const { id } = await ctx.params;

  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", activeUserId).is("read_at", null);

  if (error) return jsonUserFacingError(error, { status: 500 });
  return NextResponse.json({ ok: true });
}
