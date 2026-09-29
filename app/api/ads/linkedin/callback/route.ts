import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { verifyOAuthState } from "@/lib/security";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import { isAdsPilotAdmin } from "@/lib/adsServer";
import { exchangeLinkedInAdsCode, getLinkedInAdsRedirectUri, saveLinkedInAdsConnection, LinkedInAdsConnectionError } from "@/lib/adsLinkedInServer";
import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = verifyOAuthState<{ accountId?: string; authUserId?: string; mode?: string }>(
    request, "ads_linkedin", url.searchParams.get("state"),
  );
  const finish = (result: "connected" | "error", reason?: string) => {
    const destination = new URL("/dashboard/ads?channel=linkedin", request.url);
    destination.searchParams.set("connection", result);
    if (reason) destination.searchParams.set("reason", reason.slice(0, 150));
    const response = NextResponse.redirect(destination);
    response.cookies.set(state.cookieName, "", {
      httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/", maxAge: 0,
    });
    return response;
  };
  if (!state.ok) return finish("error", "oauth_state_invalid");
  if (state.state.mode !== "read" && state.state.mode !== "manage") return finish("error", "invalid_access_mode");
  const code = url.searchParams.get("code");
  if (!code) return finish("error", url.searchParams.get("error") || "authorization_cancelled");
  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || data.user.id !== state.state.authUserId) return finish("error", "auth_required");
    if (!(await isAdsPilotAdmin(data.user.id))) return finish("error", "ads_pilot_only");
    const userId = await resolveOAuthBoundInrcyAccountId(supabase, data.user.id, state.state.accountId);
    const userLimited = await enforceRateLimit({
      name: "oauth_linkedin_ads_callback",
      identifier: userId,
      limit: 10,
      fallbackLimit: 5,
      window: "10 m",
      code: "linkedin_ads_oauth_rate_limit",
    });
    if (userLimited) return finish("error", "rate_limited");
    const ipLimited = await enforceRateLimit({
      name: "oauth_linkedin_ads_callback_ip",
      identifier: getClientIp(request),
      limit: 20,
      fallbackLimit: 10,
      window: "10 m",
      code: "linkedin_ads_oauth_rate_limit",
    });
    if (ipLimited) return finish("error", "rate_limited");
    const token = await exchangeLinkedInAdsCode(code, getLinkedInAdsRedirectUri(request.url));
    await saveLinkedInAdsConnection(userId, token, state.state.mode);
    return finish("connected");
  } catch (error) {
    return finish("error", error instanceof LinkedInAdsConnectionError ? error.code : "connection_failed");
  }
}
