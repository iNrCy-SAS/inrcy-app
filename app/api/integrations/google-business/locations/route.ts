import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getGmbToken } from "@/lib/googleBusiness";
import { discoverGoogleBusinessLocations } from "@/lib/googleBusinessLocations";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reconcileGmbSelection } from "@/lib/googleBusinessSelectionReconciliation";
import { clearAllToolCaches } from "@/lib/statsCache";
import { readGmbVerification, type GmbVerificationStatus } from "@/lib/googleBusinessVerification";
import { persistGmbVerification, readStoredGmbVerificationStatus } from "@/lib/googleBusinessVerificationStore";

export async function GET(request?: Request) {
  try {
    const supabase = await createSupabaseServer();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth?.user) return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });

    const tok = await getGmbToken();
    if (!tok?.accessToken) return NextResponse.json({ error: "Compte Google Business non connecté." }, { status: 400 });
    const forceVerificationRefresh = request ? new URL(request.url).searchParams.get("refreshVerification") === "1" : false;

    const discovery = await discoverGoogleBusinessLocations(tok.accessToken, String(tok.row.meta?.account || ""));
    const selectionValidation = await reconcileGmbSelection({ db: supabaseAdmin, userId: tok.row.user_id, row: tok.row, discovery });
    let verification: { status: GmbVerificationStatus; locationName: string | null; clearedStatsReconnect: boolean } = { status: "unknown", locationName: null, clearedStatsReconnect: false };
    if (selectionValidation.status === "valid") {
      const parent = typeof tok.row.meta?.account === "string" ? tok.row.meta.account : "";
      const selected = discovery.locations.find(location => location.name === tok.row.resource_id && (!parent || location.accountName === parent));
      if (selected) {
        const cachedStatus = readStoredGmbVerificationStatus(tok.row.meta, selected.name, selected.accountName);
        // Passing unknown confirms the original cached snapshot without extending
        // its evidence timestamp. Metadata can independently confirm verified.
        const status = selected.hasVoiceOfMerchant === true && cachedStatus !== "verified" ? "verified"
          : !forceVerificationRefresh && cachedStatus !== "unknown" ? "unknown"
            : selected.hasVoiceOfMerchant === true ? "verified" : await readGmbVerification(tok.accessToken, selected.name);
        const persisted = await persistGmbVerification({ db: supabaseAdmin, userId: tok.row.user_id, row: tok.row, locationName: selected.name, accountName: selected.accountName, status, selectionValidated: true });
        if (persisted.persisted) verification = { status: persisted.status, locationName: selected.name, clearedStatsReconnect: persisted.clearedStatsReconnect };
      }
    }
    if (selectionValidation.cleared || verification.clearedStatsReconnect) await clearAllToolCaches(supabase, tok.row.user_id);
    return NextResponse.json({
      ...discovery,
      selectionValidation,
      verification,
      accountName: discovery.accounts.length === 1 ? discovery.accounts[0].name : null,
      locationsError: discovery.complete ? null : "Certains comptes Google Business n’ont pas pu être chargés. Réessayez pour afficher tous leurs établissements.",
    });
  } catch (e: unknown) {
    return jsonUserFacingError(e, { status: 500 });
  }
}
