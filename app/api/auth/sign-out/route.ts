import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { isBasicNavigation, withBasicNavigation } from "@/lib/basicNavigation";

export const runtime = "nodejs";

/**
 * Uses a regular route instead of a Server Action so an old blocked-account
 * page cannot submit an obsolete action id after a deployment.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServer();
  try {
    await supabase.auth.signOut();
  } catch {
    // The local session should still be sent to the login page if Supabase is
    // temporarily unavailable.
  }

  const basicNavigation = isBasicNavigation(new URL(request.url).searchParams.get("entry"));
  return NextResponse.redirect(new URL(withBasicNavigation("/login", basicNavigation), request.url), { status: 303 });
}
