import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getClientIp, enforceRateLimit } from "@/lib/rateLimit";
import { openSignupAccess, signupAccessMatchesUser, SIGNUP_ACCESS_COOKIE } from "@/lib/signupImmediateAccessPolicy";
import { signupAccessSecret } from "@/lib/signupImmediateAccessServer";
import { ACTIVE_INRCY_ACCOUNT_COOKIE } from "@/lib/multicompte/constants";
import { getDirectSignupMetadata } from "@/lib/directSignupPolicy";
import { isBasicNavigation, withBasicNavigation } from "@/lib/basicNavigation";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
function failure(message: string, status = 400, basicNavigation = false) {
  return new NextResponse(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connexion iNrCy</title><body style="font:18px system-ui;background:#071127;color:white;padding:40px;max-width:680px;margin:auto"><h1>Votre accès iNrCy</h1><p>${message}</p><p>Vos identifiants restent affichés dans l’onglet d’inscription.</p><a style="color:#70dafa" href="${withBasicNavigation("/login", basicNavigation)}">Ouvrir la connexion</a></body></html>`, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" } });
}
export async function POST(request: Request) {
  let basicNavigation = isBasicNavigation(new URL(request.url).searchParams.get("entry"));
  const fail = (message: string, status = 400) => failure(message, status, basicNavigation);
  const origin = request.headers.get("origin");
  const ownOrigin = new URL(request.url).origin;
  if (!origin || !["https://inrcy.com", "https://www.inrcy.com", ownOrigin].includes(origin)) return fail("Cette demande de connexion n’est pas autorisée.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return fail("Demande invalide.");
  if (Number(request.headers.get("content-length") || 0) > 6000) return fail("Demande invalide.");
  const limited = await enforceRateLimit({ name: "signup_access", identifier: getClientIp(request), limit: 12, window: "10 m", fallbackLimit: 6 });
  if (limited) { for (const [key, value] of Object.entries(headers)) limited.headers.set(key, value); return limited; }
  try {
    const body = await request.text();
    if (body.length > 6000) return fail("Demande invalide.");
    const ticket = new URLSearchParams(body).get("ticket");
    const claims = openSignupAccess(ticket, signupAccessSecret());
    if (!claims) return fail("Cet accès automatique a expiré. Connectez-vous avec les identifiants affichés après votre inscription.");
    const fresh = await supabaseAdmin.auth.admin.getUserById(claims.userId);
    if (fresh.error || !fresh.data.user || !signupAccessMatchesUser(claims, fresh.data.user)) return fail("Cet accès automatique n’est plus disponible. Utilisez votre mot de passe actuel.");
    basicNavigation ||= Boolean(getDirectSignupMetadata(fresh.data.user.app_metadata));
    const supabase = await createSupabaseServer();
    const current = await supabase.auth.getUser();
    if (current.data.user && current.data.user.id !== claims.userId) return fail("Un autre compte est déjà connecté dans ce navigateur. Déconnectez-le ou utilisez un autre profil de navigateur avant de continuer.", 409);
    const result = await supabase.auth.verifyOtp({ token_hash: claims.tokenHash, type: "email" });
    if (result.error || result.data.user?.id !== claims.userId || !result.data.session) return fail("Cet accès à usage unique a déjà été utilisé ou a expiré. Utilisez vos identifiants pour vous connecter.");
    const cookieStore = await cookies();
    cookieStore.set(SIGNUP_ACCESS_COOKIE, ticket!, { httpOnly: true, secure: ownOrigin.startsWith("https:"), sameSite: "strict", path: "/api/auth/signup-access", maxAge: Math.max(1, Math.floor((claims.expiresAt - Date.now()) / 1000)) });
    const destination = "/dashboard";
    const response = NextResponse.redirect(new URL(`${destination}?lang=${claims.language}`, request.url), { status: 303, headers });
    response.cookies.set(ACTIVE_INRCY_ACCOUNT_COOKIE, claims.userId, { path: "/", sameSite: "lax", secure: ownOrigin.startsWith("https:"), maxAge: 30 * 86400 });
    return response;
  } catch { return fail("La connexion automatique est momentanément indisponible. Utilisez les identifiants affichés après votre inscription.", 503); }
}
