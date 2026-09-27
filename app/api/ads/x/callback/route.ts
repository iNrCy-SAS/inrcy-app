import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { decryptToken } from "@/lib/oauthCrypto";
import { getCookie, verifyOAuthState } from "@/lib/security";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import { isAdsPilotAdmin } from "@/lib/adsServer";
import { exchangeXAdsAccessToken, saveXAdsConnection, XAdsConnectionError } from "@/lib/adsXServer";

const X_ADS_REQUEST_COOKIE = "inrcy_oauth_x_ads_request";
type TemporaryCredential = { stateB64?: unknown; token?: unknown; tokenSecret?: unknown };

function equalTokens(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let temporary: TemporaryCredential = {};
  try {
    const decoded = JSON.parse(decryptToken(getCookie(request, X_ADS_REQUEST_COOKIE) || "")) as unknown;
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) temporary = decoded as TemporaryCredential;
  } catch { /* Missing or tampered one-time credential fails closed. */ }
  const state = verifyOAuthState<{ accountId?: string; authUserId?: string }>(
    request, "ads_x", typeof temporary.stateB64 === "string" ? temporary.stateB64 : null,
  );
  const finish = (result: "connected" | "error", reason?: string) => {
    const destination = new URL("/dashboard/ads?channel=x", request.url);
    destination.searchParams.set("connection", result);
    if (reason) destination.searchParams.set("reason", reason.slice(0, 150));
    const response = NextResponse.redirect(destination);
    const options = { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax" as const, path: "/", maxAge: 0 };
    response.cookies.set(state.cookieName, "", options);
    response.cookies.set(X_ADS_REQUEST_COOKIE, "", options);
    return response;
  };
  if (!state.ok || typeof temporary.token !== "string" || typeof temporary.tokenSecret !== "string") {
    return finish("error", "oauth_state_invalid");
  }
  const returnedToken = url.searchParams.get("oauth_token") || "";
  const verifier = url.searchParams.get("oauth_verifier") || "";
  if (!returnedToken || !verifier) return finish("error", "authorization_cancelled");
  if (!equalTokens(temporary.token, returnedToken)) return finish("error", "oauth_token_mismatch");
  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || data.user.id !== state.state.authUserId) return finish("error", "auth_required");
    if (!(await isAdsPilotAdmin(data.user.id))) return finish("error", "ads_pilot_only");
    const userId = await resolveOAuthBoundInrcyAccountId(supabase, data.user.id, state.state.accountId);
    const token = await exchangeXAdsAccessToken(temporary.token, temporary.tokenSecret, verifier);
    await saveXAdsConnection(userId, token);
    return finish("connected");
  } catch (error) {
    return finish("error", error instanceof XAdsConnectionError ? error.code : "connection_failed");
  }
}
