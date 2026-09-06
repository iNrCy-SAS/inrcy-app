import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/adminSecurity";
import { encryptToken } from "@/lib/oauthCrypto";
import { requireUser } from "@/lib/requireUser";
import { verifyOAuthState } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  VISIO_BOOKING_GOOGLE_SCOPES,
  VISIO_BOOKING_INTEGRATION,
} from "@/lib/visioBookingGoogle";

export const runtime = "nodejs";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

function redirectResult(origin: string, ok: boolean, error = "") {
  const url = new URL("/dashboard", origin);
  url.searchParams.set("visio_booking_google", ok ? "connected" : "error");
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const url = new URL(request.url);
  const state = verifyOAuthState<{ adminUserId?: string }>(
    request,
    "visio_booking_google",
    url.searchParams.get("state"),
  );
  const finish = (response: NextResponse) => {
    response.cookies.set(state.cookieName, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || origin.startsWith("https://"),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  };

  if (!state.ok) return finish(redirectResult(origin, false, "invalid_state"));
  const admin = await requireAdminApi();
  if (!admin.ok) return finish(redirectResult(origin, false, "admin_required"));
  const session = await requireUser();
  if (session.errorResponse) {
    return finish(redirectResult(origin, false, "auth_required"));
  }
  if (state.state.adminUserId !== session.authUserId) {
    return finish(redirectResult(origin, false, "account_mismatch"));
  }

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) {
    return finish(redirectResult(origin, false, url.searchParams.get("error") || "missing_code"));
  }

  try {
    const redirectUri =
      process.env.INRCY_VISIO_GOOGLE_REDIRECT_URI ||
      `${origin}/api/admin/visio-booking/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: String(process.env.GOOGLE_CLIENT_ID || ""),
        client_secret: String(process.env.GOOGLE_CLIENT_SECRET || ""),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    const token = (await tokenResponse.json().catch(() => ({}))) as TokenResponse;
    if (!tokenResponse.ok || !token.access_token) {
      throw new Error(token.error_description || token.error || "token_exchange_failed");
    }

    const grantedScopes = new Set(String(token.scope || "").split(/\s+/).filter(Boolean));
    if (VISIO_BOOKING_GOOGLE_SCOPES.some((scope) => !grantedScopes.has(scope))) {
      throw new Error("missing_required_scopes");
    }

    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      cache: "no-store",
    });
    const googleUser = (await userResponse.json().catch(() => ({}))) as {
      id?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    if (!userResponse.ok || !googleUser.email) throw new Error("userinfo_failed");

    const expectedEmail = String(process.env.INRCY_VISIO_GOOGLE_ACCOUNT_EMAIL || "")
      .trim()
      .toLowerCase();
    if (expectedEmail && googleUser.email.toLowerCase() !== expectedEmail) {
      throw new Error("unexpected_google_account");
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("integrations")
      .select("id,refresh_token_enc")
      .eq("user_id", session.authUserId)
      .eq("provider", "google")
      .eq("source", VISIO_BOOKING_INTEGRATION.source)
      .eq("product", VISIO_BOOKING_INTEGRATION.product)
      .maybeSingle();
    if (existingError) throw existingError;
    const existingRow = (existing || {}) as Record<string, unknown>;
    const refreshTokenEnc = token.refresh_token
      ? encryptToken(token.refresh_token)
      : typeof existingRow.refresh_token_enc === "string"
        ? existingRow.refresh_token_enc
        : null;
    if (!refreshTokenEnc) throw new Error("refresh_token_missing");

    const payload = {
      user_id: session.authUserId,
      provider: "google",
      category: "calendar",
      source: VISIO_BOOKING_INTEGRATION.source,
      product: VISIO_BOOKING_INTEGRATION.product,
      status: "connected",
      email_address: googleUser.email.toLowerCase(),
      display_name: googleUser.name || null,
      provider_account_id: googleUser.id || null,
      scopes: token.scope || VISIO_BOOKING_GOOGLE_SCOPES.join(" "),
      access_token_enc: encryptToken(token.access_token),
      refresh_token_enc: refreshTokenEnc,
      expires_at: new Date(
        Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1_000,
      ).toISOString(),
      meta: {
        purpose: "signup_visio_booking",
        picture: googleUser.picture || null,
      },
      updated_at: new Date().toISOString(),
    };

    if (typeof existingRow.id === "string" && existingRow.id) {
      const { error } = await supabaseAdmin
        .from("integrations")
        .update(payload)
        .eq("id", existingRow.id)
        .eq("user_id", session.authUserId);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from("integrations").insert(payload);
      if (error) throw error;
    }
    return finish(redirectResult(origin, true));
  } catch (error) {
    console.error(
      "[visio-booking][google-callback]",
      error instanceof Error ? error.message : "oauth_failed",
    );
    return finish(
      redirectResult(
        origin,
        false,
        error instanceof Error ? error.message.slice(0, 80) : "oauth_failed",
      ),
    );
  }
}
