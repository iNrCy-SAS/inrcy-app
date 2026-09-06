import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/adminSecurity";
import { requireUser } from "@/lib/requireUser";
import { VISIO_BOOKING_GOOGLE_SCOPES } from "@/lib/visioBookingGoogle";
import {
  createVisioBookingOAuthState,
  getVisioBookingOAuthStateSecret,
} from "@/lib/visioBookingOAuthState";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;
  const session = await requireUser();
  if (session.errorResponse) return session.errorResponse;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "Configuration Google incomplète." },
      { status: 503 },
    );
  }

  const origin = new URL(request.url).origin;
  const redirectUri =
    process.env.INRCY_VISIO_GOOGLE_REDIRECT_URI ||
    `${origin}/api/admin/visio-booking/google/callback`;
  const oauthState = createVisioBookingOAuthState({
    adminUserId: session.authUserId,
    secret: getVisioBookingOAuthStateSecret(),
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: VISIO_BOOKING_GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: oauthState,
  });
  const loginHint = String(process.env.INRCY_VISIO_GOOGLE_ACCOUNT_EMAIL || "")
    .trim()
    .toLowerCase();
  if (loginHint) params.set("login_hint", loginHint);

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
