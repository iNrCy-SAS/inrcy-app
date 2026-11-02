import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildGoogleRiscStatusFromRows } from "@/lib/security/googleRiscStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { data } = await supabaseAdmin
    .from("integrations")
    .select("source,product,meta")
    .eq("user_id", activeUserId)
    .in("provider", ["google", "gmail"]);

  return NextResponse.json({ ok: true, reauth: buildGoogleRiscStatusFromRows(data || []) });
}
