import { NextResponse } from "next/server";

import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSupabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// Une prise atomique côté serveur remplace le marqueur local au navigateur.
// Les comptes présents avant la migration sont déjà marqués comme vus.
export async function POST(request: Request) {
  const supabase = await createSupabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  let accountId: string;
  try {
    accountId = await resolveActiveInrcyAccountId(supabase, user.id);
  } catch {
    return NextResponse.json({ error: "Établissement indisponible." }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { accountId?: unknown } | null;
  if (body?.accountId !== accountId) {
    // Une bascule d'établissement pendant le chargement ne doit pas consommer
    // l'introduction d'un autre compte.
    return NextResponse.json({ error: "Établissement modifié." }, { status: 409 });
  }

  const { data, error } = await supabaseAdmin
    .from("inrcy_accounts")
    .update({ dashboard_setup_intro_seen_at: new Date().toISOString() })
    .eq("id", accountId)
    .is("dashboard_setup_intro_seen_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[dashboard/setup-intro] claim failed", { accountId, code: error.code });
    return NextResponse.json({ error: "Introduction indisponible." }, { status: 503 });
  }

  return NextResponse.json(
    { accountId, show: Boolean(data) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
