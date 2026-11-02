import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { revokeGoogleTokensBestEffort, shouldRevokeGoogleTokensForDisconnect } from "@/lib/googleOAuthRevoke";
type RevokeRow = { id?: string | null; access_token_enc?: string | null; refresh_token_enc?: string | null; provider_account_id?: string | null; email_address?: string | null; account_email?: string | null };
/**
 * Déconnecte un compte Gmail (supprime la ligne integrations).
 * Le front passe { accountId }.
 */
export async function POST(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const userId = activeUserId;
const body = await req.json().catch(() => ({}));
  const accountId = String(body.accountId || "").trim();

  if (!accountId) return NextResponse.json({ error: "Identifiant de compte manquant." }, { status: 400 });

  const { data: rowToRevoke } = await supabaseAdmin
    .from("integrations")
    .select("id,access_token_enc,refresh_token_enc,provider_account_id,email_address,account_email")
    .eq("id", accountId)
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .eq("category", "mail")
    .maybeSingle();

  const revokeRow = rowToRevoke as RevokeRow | null;
  const canRevokeGoogleAuth = revokeRow
    ? await shouldRevokeGoogleTokensForDisconnect({
        userId,
        rows: [revokeRow],
        context: "gmail_disconnect",
      })
    : false;

  if (canRevokeGoogleAuth && revokeRow) {
    await revokeGoogleTokensBestEffort({
      integrationId: String(revokeRow.id || ""),
      accessTokenEnc: revokeRow.access_token_enc || null,
      refreshTokenEnc: revokeRow.refresh_token_enc || null,
      context: "gmail_disconnect",
    });
  }

  const { error } = await supabase
    .from("integrations")
    .delete()
    .eq("id", accountId)
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .eq("category", "mail");

  if (error) {
    return jsonUserFacingError(error, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}