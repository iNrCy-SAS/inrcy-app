import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { tryDecryptToken } from "@/lib/oauthCrypto";
import { asRecord, asString } from "@/lib/tsSafe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import {
  extractFacebookUserTokens,
  inspectFacebookUserTokenPermissions,
  listAccessibleFacebookPagesFromTokensDetailed,
} from "@/lib/metaBusinessAssets";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { log } from "@/lib/observability/logger";

const REQUIRED_DISCOVERY_PERMISSIONS = ["pages_show_list", "pages_read_engagement"] as const;

function jsonNoStore(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function GET() {
  try {
    const supabase = await createSupabaseServer();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth?.user) return jsonNoStore({ error: "Accès non autorisé." }, 401);

    const userId = await resolveActiveInrcyAccountId(supabase, auth.user.id);

    const { data: integ, error: integErr } = await supabaseAdmin
      .from("integrations")
      .select("access_token_enc,status,meta")
      .eq("user_id", userId)
      .eq("provider", "facebook")
      .eq("source", "facebook")
      .eq("product", "facebook")
      .maybeSingle();

    if (integErr) return jsonNoStore({ error: "Impossible de récupérer la connexion Facebook pour le moment." }, 500);
    if (!integ || (integ.status !== "connected" && integ.status !== "account_connected") || !integ.access_token_enc) {
      return jsonNoStore({ error: "Compte Facebook non connecté." }, 400);
    }

    const integRec = asRecord(integ);
    const metaRec = asRecord(integRec["meta"]);
    const encryptedTokens = extractFacebookUserTokens(metaRec, asString(integRec["access_token_enc"]) || null);
    const userTokens = Array.from(new Set(
      encryptedTokens.map((raw) => tryDecryptToken(raw)).filter((value): value is string => !!value),
    ));
    if (!userTokens.length) return jsonNoStore({ error: "La connexion Facebook doit être relancée pour récupérer vos pages." }, 400);

    const discovery = await listAccessibleFacebookPagesFromTokensDetailed(userTokens);
    if (discovery.pages.length > 0) {
      // Selection rechecks native access on the server; Page credentials never leave it.
      const pages = discovery.pages.map((page) => ({
        id: page.id,
        name: page.name,
        source: page.source,
        business_id: page.business_id || null,
        business_name: page.business_name || null,
      }));
      return jsonNoStore({ pages });
    }

    const checks = await Promise.all(userTokens.map((token) => inspectFacebookUserTokenPermissions(token)));
    const successfulChecks = checks.filter((check) => !check.issue);
    const completeCheck = successfulChecks.some((check) =>
      REQUIRED_DISCOVERY_PERMISSIONS.every((permission) => check.permissions[permission] === "granted"),
    );
    const missingPermissions = successfulChecks
      .map((check) => REQUIRED_DISCOVERY_PERMISSIONS.filter((permission) => check.permissions[permission] !== "granted"))
      .sort((a, b) => a.length - b.length)[0] || [];

    log.info("facebook_page_discovery_empty", {
      user_id: userId,
      token_count: discovery.diagnostics.token_count,
      successful_token_count: discovery.diagnostics.successful_token_count,
      issue_stages: Array.from(new Set(discovery.diagnostics.issues.map((issue) => issue.stage))),
      meta_error_codes: Array.from(new Set(discovery.diagnostics.issues.map((issue) => issue.code).filter((code) => code !== null))),
      permission_checks_succeeded: successfulChecks.length,
      missing_permissions: completeCheck ? [] : missingPermissions,
    });

    if (successfulChecks.length === userTokens.length && !completeCheck) {
      return jsonNoStore({
        code: "facebook_permissions_incomplete",
        user_message: "Meta n'a pas accordé toutes les autorisations de lecture des Pages. Relancez la connexion standard et sélectionnez la Page concernée.",
        can_reauthorize: true,
        missing_permissions: missingPermissions,
      }, 409);
    }

    if (discovery.diagnostics.successful_token_count > 0) {
      return jsonNoStore({
        code: "facebook_pages_not_returned",
        user_message: "Meta n'a renvoyé aucune Page accessible pour cette connexion. Vérifiez la Page sélectionnée dans les autorisations, puis rechargez vos Pages.",
        can_retry: true,
        can_reauthorize: true,
      }, 409);
    }

    return jsonNoStore({
      code: "meta_page_discovery_failed",
      user_message: "Meta n'a pas pu renvoyer vos Pages pour le moment. Réessayez avec « Charger mes pages » ; votre connexion a été conservée.",
      can_retry: true,
      can_reauthorize: true,
    }, 502);
  } catch (error: unknown) {
    const response = jsonUserFacingError(error, { status: 500 });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  }
}
