import { NextResponse } from "next/server";

import { isAppBubbleEnabledForUser } from "@/lib/appBubbleAccessServer";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { encryptToken } from "@/lib/oauthCrypto";
import { clearAllToolCaches } from "@/lib/statsCache";
import { withCurrentConnectionVersion } from "@/lib/connectionVersions";
import { safeInternalPath, verifyOAuthState } from "@/lib/security";
import { asRecord, asString } from "@/lib/tsSafe";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import {
  buildPinterestTokenDates,
  exchangePinterestAuthorizationCode,
  getPinterestApiEnvironment,
  getPinterestOAuthScope,
  PINTEREST_PRODUCT,
  PINTEREST_PROVIDER,
  PINTEREST_SOURCE,
} from "@/lib/pinterestOAuth";

function normalizeSettingsRoot(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(request: Request) {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  let returnTo = "/dashboard?panel=pinterest";

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");
    const oauthErrorDescription = url.searchParams.get("error_description");

    const st = verifyOAuthState(request, "pinterest", stateRaw);
    returnTo = safeInternalPath(st.returnTo || "/dashboard?panel=pinterest", "/dashboard?panel=pinterest");

    const clearStateCookie = (res: NextResponse) => {
      res.cookies.set(st.cookieName, "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return res;
    };

    const fail = (error: string, message?: string) => {
      const finalUrl = new URL(returnTo, siteUrl);
      finalUrl.searchParams.set("linked", "pinterest");
      finalUrl.searchParams.set("ok", "0");
      finalUrl.searchParams.set("error", error);
      if (message) {
        finalUrl.searchParams.set(
          "message",
          getSimpleFrenchErrorMessage(message, "La connexion Pinterest n'a pas pu être finalisée.").slice(0, 200),
        );
      }
      return clearStateCookie(NextResponse.redirect(finalUrl));
    };

    if (!st.ok) {
      return clearStateCookie(
        NextResponse.redirect(new URL("/dashboard?panel=pinterest&linked=pinterest&ok=0&error=oauth_state", siteUrl)),
      );
    }

    if (oauthError || !code) {
      return fail(oauthError || "missing_code", oauthErrorDescription || "La connexion Pinterest a été annulée ou incomplète.");
    }

    const supabase = await createSupabaseServer();
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authErr || !user) return fail("not_authenticated", "Tu dois être connecté à iNrCy pour connecter Pinterest.");
    const activeUserId = await resolveOAuthBoundInrcyAccountId(supabase, user.id, st.state.accountId);

    if (!(await isAppBubbleEnabledForUser(supabase, activeUserId, "pinterest"))) {
      return fail("bubble_access_disabled", "Pinterest est désactivé dans Bubble Access.");
    }

    const token = await exchangePinterestAuthorizationCode(code, request.url);
    const accessToken = asString(token.access_token) || "";
    if (!accessToken) return fail("missing_access_token", "Pinterest n'a pas renvoyé de jeton d'accès.");

    const dates = buildPinterestTokenDates(token);
    const scope = asString(token.scope) || getPinterestOAuthScope();

    const meta = withCurrentConnectionVersion("channel:pinterest", {
      pinterest_api_environment: getPinterestApiEnvironment(),
      refresh_expires_at: dates.refreshExpiresAt,
    });

    await supabaseAdmin.from("integrations").upsert(
      {
        user_id: activeUserId,
        provider: PINTEREST_PROVIDER,
        category: "social",
        source: PINTEREST_SOURCE,
        product: PINTEREST_PRODUCT,
        status: "connected",
        display_name: "Compte Pinterest",
        provider_account_id: null,
        scopes: scope,
        access_token_enc: encryptToken(accessToken),
        refresh_token_enc: token.refresh_token ? encryptToken(token.refresh_token) : null,
        expires_at: dates.expiresAt,
        resource_id: null,
        resource_label: null,
        meta,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider,source,product" },
    );

    const { data: cfg } = await supabaseAdmin
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", activeUserId)
      .maybeSingle();
    const root = normalizeSettingsRoot(asRecord(cfg).settings);
    const currentPinterest = normalizeSettingsRoot(root.pinterest);
    const nextPinterest = { ...currentPinterest };
    // Pinterest interdit la conservation durable des informations lues via son API.
    // On ne garde ici que des préférences propres à iNrCy ; le profil et les tableaux sont relus en direct.
    for (const key of [
      "boards",
      "avatarUrl",
      "websiteUrl",
      "accountType",
      "accountName",
      "displayName",
      "username",
      "profileUrl",
      "url",
      "defaultBoardName",
      "boardId",
      "boardName",
      "scopes",
      "expiresAt",
      "connected",
      "accountConnected",
      "mode",
    ]) {
      delete nextPinterest[key];
    }

    await supabaseAdmin
      .from("pro_tools_configs")
      .upsert({ user_id: activeUserId, settings: { ...root, pinterest: nextPinterest } }, { onConflict: "user_id" });

    await clearAllToolCaches(supabase, activeUserId);

    const finalUrl = new URL(returnTo, siteUrl);
    finalUrl.searchParams.set("linked", "pinterest");
    finalUrl.searchParams.set("ok", "1");
    return clearStateCookie(NextResponse.redirect(finalUrl));
  } catch (error) {
    const finalUrl = new URL(returnTo, siteUrl);
    finalUrl.searchParams.set("linked", "pinterest");
    finalUrl.searchParams.set("ok", "0");
    finalUrl.searchParams.set("error", "oauth_callback_failed");
    const message = getSimpleFrenchErrorMessage(error, "La connexion Pinterest n'a pas pu être finalisée.").slice(0, 200);
    if (message) finalUrl.searchParams.set("message", message);
    return NextResponse.redirect(finalUrl);
  }
}
