import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getGmbToken } from "@/lib/googleBusiness";
import { discoverGoogleBusinessLocations } from "@/lib/googleBusinessLocations";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";

export async function GET() {
  try {
    const supabase = await createSupabaseServer();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth?.user) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });

    const tok = await getGmbToken();
    if (!tok?.accessToken) return NextResponse.json({ error: "Compte Google Business non connecté." }, { status: 400 });

    const discovery = await discoverGoogleBusinessLocations(tok.accessToken, String(tok.row.meta?.account || ""));
    return NextResponse.json({
      ...discovery,
      accountName: discovery.accounts.length === 1 ? discovery.accounts[0].name : null,
      locationsError: discovery.complete ? null : "Certains comptes Google Business n’ont pas pu être chargés. Réessayez pour afficher tous leurs établissements.",
    });
  } catch (e: unknown) {
    return jsonUserFacingError(e, { status: 500 });
  }
}
