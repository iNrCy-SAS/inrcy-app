import { NextResponse } from "next/server";

import { revalidateInrSearchPublicRoutes } from "@/lib/inrSearchProvisioning";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord } from "@/lib/tsSafe";
import { syncNativeChannelsForAccount } from "@/lib/nativeChannelActivationServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown, max = 160) {
  return String(value ?? "").trim().slice(0, max).trim();
}

export async function POST() {
  try {
    const supabase = await createSupabaseServer();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user?.id) {
      return NextResponse.json({ ok: false, error: "Session absente." }, { status: 401 });
    }

    const accountId = await resolveActiveInrcyAccountId(supabase, authData.user.id);
    const nativeChannels = await syncNativeChannelsForAccount(accountId, undefined, { profileSaved: true });
    const { data, error } = await supabaseAdmin
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", accountId)
      .maybeSingle();

    if (error) {
      console.error("[public-profile/refresh] config read failed", error);
      return NextResponse.json({ ok: false, error: "Actualisation indisponible." }, { status: 502 });
    }

    const settings = asRecord((data as { settings?: unknown } | null)?.settings);
    const inrSearch = asRecord(settings.inrSearch);
    const slug = clean(inrSearch.slug);

    if (slug) revalidateInrSearchPublicRoutes(slug);

    return NextResponse.json(
      { ok: true, inrSearchRevalidated: Boolean(slug), slug, nativeChannels: nativeChannels.states },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("[public-profile/refresh] refresh failed", error);
    return NextResponse.json({ ok: false, error: "Actualisation indisponible." }, { status: 500 });
  }
}
