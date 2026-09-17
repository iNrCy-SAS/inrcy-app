import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { tryDecryptToken } from "@/lib/oauthCrypto";
import { asRecord, asString } from "@/lib/tsSafe";
import {
  extractFacebookUserTokens,
  inspectFacebookUserTokenPermissions,
  listAccessibleFacebookPagesFromTokensDetailed,
} from "@/lib/metaBusinessAssets";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { log } from "@/lib/observability/logger";

const REQUIRED_DISCOVERY_PERMISSIONS = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
] as const;

function jsonNoStore(body: Record<string, unknown>, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function GET() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) return jsonNoStore({ error: "Accès non autorisé." }, 401);
  const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

  const { data: rows, error: integrationError } = await supabase
    .from("integrations")
    .select("status,access_token_enc,meta")
    .eq("user_id", activeUserId)
    .eq("provider", "instagram")
    .eq("source", "instagram")
    .eq("product", "instagram")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (integrationError) {
    log.error("instagram_account_discovery_integration_read_failed", {
      user_id: activeUserId,
      error_code: integrationError.code || null,
    });
    return jsonNoStore(
      {
        code: "instagram_connection_read_failed",
        user_message: "La connexion Instagram n'a pas pu être vérifiée. Merci de réessayer.",
      },
      503,
    );
  }

  const row = (rows?.[0] as unknown) ?? null;
  const rowRec = asRecord(row);
  const metaRec = asRecord(rowRec["meta"]);
  const encryptedTokens = extractFacebookUserTokens(metaRec, asString(rowRec["access_token_enc"]) || null);
  const userTokens = Array.from(
    new Set(encryptedTokens.map((raw) => tryDecryptToken(raw)).filter((value): value is string => !!value)),
  );
  if (!userTokens.length) {
    return jsonNoStore(
      {
        code: "instagram_account_not_connected",
        user_message: "Compte Instagram non connecté.",
      },
      400,
    );
  }

  const discovery = await listAccessibleFacebookPagesFromTokensDetailed(userTokens);
  const accounts = discovery.pages
    .filter((page) => page.instagram_business_account?.id)
    .map((page) => ({
      page_id: page.id,
      page_name: page.name || null,
      ig_id: page.instagram_business_account?.id || "",
      username: page.instagram_business_account?.username || "",
      page_access_token: page.access_token || null,
      source: page.source,
      business_name: page.business_name || null,
    }));

  if (accounts.length > 0) {
    if (discovery.diagnostics.recovered_token_count > 0 || discovery.diagnostics.issues.length > 0) {
      log.info("instagram_account_discovery_recovered", {
        user_id: activeUserId,
        account_count: accounts.length,
        page_count: discovery.pages.length,
        token_count: discovery.diagnostics.token_count,
        recovered_token_count: discovery.diagnostics.recovered_token_count,
        issue_stages: Array.from(new Set(discovery.diagnostics.issues.map((issue) => issue.stage))),
      });
    }

    return jsonNoStore({
      accounts,
      discovery: {
        page_count: discovery.pages.length,
        recovered: discovery.diagnostics.recovered_token_count > 0,
      },
    });
  }

  const permissionChecks = await Promise.all(userTokens.map((token) => inspectFacebookUserTokenPermissions(token)));
  const successfulPermissionChecks = permissionChecks.filter((check) => !check.issue);
  const allPermissionChecksSucceeded = successfulPermissionChecks.length === userTokens.length;
  const completePermissionCheck = successfulPermissionChecks.find((check) =>
    REQUIRED_DISCOVERY_PERMISSIONS.every((permission) => check.permissions[permission] === "granted"),
  );

  const requiredMissingForBestToken = successfulPermissionChecks
    .map((check) => REQUIRED_DISCOVERY_PERMISSIONS.filter((permission) => check.permissions[permission] !== "granted"))
    .sort((a, b) => a.length - b.length)[0] || [];

  const nonOptionalIssues = discovery.diagnostics.issues.filter((issue) => !issue.optional);
  const issueStages = Array.from(new Set(discovery.diagnostics.issues.map((issue) => issue.stage)));
  const traceIds = Array.from(
    new Set(discovery.diagnostics.issues.map((issue) => issue.fbtrace_id).filter((value): value is string => !!value)),
  ).slice(0, 5);
  const metaErrorCodes = Array.from(
    new Set(discovery.diagnostics.issues.map((issue) => issue.code).filter((value): value is number => value !== null)),
  );
  const metaErrorSubcodes = Array.from(
    new Set(discovery.diagnostics.issues.map((issue) => issue.subcode).filter((value): value is number => value !== null)),
  );

  const discoveryHasProviderFailure =
    discovery.diagnostics.successful_token_count === 0 &&
    nonOptionalIssues.length > 0;
  log[discoveryHasProviderFailure ? "warn" : "info"]("instagram_account_discovery_empty", {
    user_id: activeUserId,
    page_count: discovery.pages.length,
    token_count: discovery.diagnostics.token_count,
    successful_token_count: discovery.diagnostics.successful_token_count,
    recovered_token_count: discovery.diagnostics.recovered_token_count,
    non_optional_issue_count: nonOptionalIssues.length,
    issue_stages: issueStages,
    meta_trace_ids: traceIds,
    meta_error_codes: metaErrorCodes,
    meta_error_subcodes: metaErrorSubcodes,
    permission_checks_succeeded: successfulPermissionChecks.length,
    missing_permissions: requiredMissingForBestToken,
    handled: !discoveryHasProviderFailure,
  });

  if (allPermissionChecksSucceeded && !completePermissionCheck) {
    return jsonNoStore(
      {
        code: "instagram_permissions_incomplete",
        user_message:
          "Meta n'a pas accordé toutes les autorisations nécessaires pour lire vos Pages et votre compte Instagram. Actualisez les autorisations Meta puis sélectionnez de nouveau la Page concernée.",
        can_reauthorize: true,
        missing_permissions: requiredMissingForBestToken,
      },
      409,
    );
  }

  if (discovery.pages.length > 0) {
    return jsonNoStore(
      {
        code: "instagram_profile_not_returned",
        user_message: `Meta a bien renvoyé ${discovery.pages.length} Page${discovery.pages.length > 1 ? "s" : ""} Facebook, mais aucun compte Instagram Business ou Creator associé. Vérifiez la liaison dans Meta Business Suite puis actualisez les autorisations.`,
        can_reauthorize: true,
        page_count: discovery.pages.length,
      },
      409,
    );
  }

  if (discovery.diagnostics.successful_token_count > 0) {
    return jsonNoStore(
      {
        code: "facebook_pages_not_returned",
        user_message:
          "Meta n'a renvoyé aucune Page Facebook pour cette autorisation, même si votre liaison Instagram semble correcte. Actualisez les autorisations Meta et vérifiez que la Page est bien sélectionnée.",
        can_reauthorize: true,
      },
      409,
    );
  }

  return jsonNoStore(
    {
      code: "meta_page_discovery_failed",
      user_message:
        "Meta n'a pas pu renvoyer vos Pages Facebook pour le moment. Aucune configuration n'a été supprimée : réessayez, puis actualisez les autorisations si le problème persiste.",
      can_retry: true,
      can_reauthorize: true,
    },
    502,
  );
}
