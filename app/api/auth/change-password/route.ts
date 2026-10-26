import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { evaluatePassword } from "@/lib/passwordPolicy";
import { TEMPORARY_PASSWORD_METADATA_KEY } from "@/lib/temporaryPasswordPolicy";
import { getClientIp, enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) {
    return json({ code: "forbidden", error: "Cette demande n’est pas autorisée." }, 403);
  }
  const supabase = await createSupabaseServer();
  const { data, error: authError } = await supabase.auth.getUser();
  const user = data?.user;
  if (authError || !user?.email) return json({ code: "auth_required", error: "Reconnectez-vous pour modifier votre mot de passe." }, 401);
  const limited = await enforceRateLimit({ name: "change_password", identifier: `${user.id}:${getClientIp(request)}`, limit: 5, window: "10 m", failClosed: true });
  if (limited) return limited;
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_body");
    body = parsed;
  } catch { return json({ code: "invalid_request", error: "Vérifiez les champs du formulaire." }, 400); }
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!currentPassword || currentPassword.length > 512 || password.length > 128 || !evaluatePassword(password).isAcceptable) {
    return json({ code: "password_rejected", error: "Choisissez un mot de passe qui respecte les critères affichés." }, 400);
  }
  if (password === currentPassword) return json({ code: "same_password", error: "Choisissez un mot de passe différent du mot de passe actuel." }, 400);
  let changed = false;
  try {
    if (user.factors?.some((factor) => factor.status === "verified")) {
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data?.currentLevel !== "aal2") {
        return json({ code: "mfa_required", error: "Confirmez votre double authentification avant de modifier le mot de passe." }, 403);
      }
    }
    // Isolated verification cannot replace the browser session. The email is
    // taken from the authenticated user, never from request parameters.
    const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const verified = await verifier.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (verified.error || verified.data.user?.id !== user.id) {
      return json({ code: "current_password_incorrect", error: "Le mot de passe actuel est incorrect." }, 400);
    }
    // Auth merges app metadata. Send only this key to preserve concurrent flags.
    // The password and removal of its temporary status are one atomic write.
    try {
      const updated = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password,
        ...(user.app_metadata?.[TEMPORARY_PASSWORD_METADATA_KEY] ? {
          app_metadata: { [TEMPORARY_PASSWORD_METADATA_KEY]: null },
        } : {}),
      });
      changed = !updated.error && updated.data.user?.id === user.id;
    } catch { /* A lost response does not prove the write failed. */ }
    if (!changed) {
      const verification = await verifier.auth.signInWithPassword({ email: user.email, password });
      changed = !verification.error && verification.data.user?.id === user.id;
    }
    if (!changed) return json({ code: "password_update_failed", error: "Impossible d’enregistrer ce mot de passe pour le moment." }, 503);
    // Restore this user's browser cookies after the password write revokes old
    // sessions. Credentials and JWTs are never returned in the JSON response.
    const signedIn = await supabase.auth.signInWithPassword({ email: user.email, password });
    return json({ ok: true, requires_login: Boolean(signedIn.error || !signedIn.data.session) });
  } catch {
    if (changed) return json({ ok: true, requires_login: true });
    return json({ code: "password_update_unavailable", error: "La modification du mot de passe n’a pas pu aboutir. Réessayez dans un instant." }, 503);
  }
}
