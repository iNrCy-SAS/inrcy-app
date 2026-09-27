import { NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/supabaseServer";
import { verifyOAuthState } from "@/lib/security";
import { resolveOAuthBoundInrcyAccountId } from "@/lib/multicompte/server";
import { isAdsPilotAdmin } from "@/lib/adsServer";
import {
  exchangeTikTokAdsCode,
  saveTikTokAdsConnection,
  tikTokAdsReturnUrl,
  TikTokAdsConnectionError,
} from "@/lib/adsTikTokServer";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = verifyOAuthState<{ accountId?: string; authUserId?: string }>(
    request,
    "ads_tiktok",
    url.searchParams.get("state"),
  );
  const finish = (result: "connected" | "error", reason?: string) => {
    const response = NextResponse.redirect(tikTokAdsReturnUrl(request.url, result, reason));
    response.cookies.set(state.cookieName, "", {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  };
  if (!state.ok) return finish("error", "oauth_state_invalid");
  const code = url.searchParams.get("auth_code") || url.searchParams.get("code");
  if (!code) return finish("error", "authorization_cancelled");

  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || data.user.id !== state.state.authUserId) {
      return finish("error", "auth_required");
    }
    if (!(await isAdsPilotAdmin(data.user.id))) return finish("error", "ads_pilot_only");
    const userId = await resolveOAuthBoundInrcyAccountId(supabase, data.user.id, state.state.accountId);
    const token = await exchangeTikTokAdsCode(code);
    await saveTikTokAdsConnection(userId, token);
    return finish("connected");
  } catch (error) {
    return finish("error", error instanceof TikTokAdsConnectionError ? error.code : "connection_failed");
  }
}
