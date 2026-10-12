import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";

export async function GET(request: Request) {
  const supabase = await createSupabaseServer();
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return NextResponse.json({ error: "Votre session a expiré. Merci de vous reconnecter." }, { status: 401 });
  const activeUserId = await resolveActiveInrcyAccountId(supabase, authData.user.id);

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  const product = searchParams.get("product");
  if (source !== "site_web" || !["ga4", "gsc"].includes(product || "")) return NextResponse.json({ error: "Source ou produit invalide." }, { status: 400 });

  const states = await getChannelConnectionStates(supabase, activeUserId);

  let connected = false;
  if (source === "site_web" && product === "ga4") connected = states.site_web.ga4;
  if (source === "site_web" && product === "gsc") connected = states.site_web.gsc;

  return NextResponse.json({ connected });
}
