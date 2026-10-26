import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { authResendApiKey, sendPreparedAuthEmail } from "@/lib/authMailDelivery";
import { getTemporaryPasswordMetadata } from "@/lib/temporaryPasswordPolicy";
import { buildSignupWelcomeEmail, createTemporarySignupCredential, openSignupPassword, sealSignupPassword } from "@/lib/signupWelcomeMailPolicy";

const TABLE = "signup_welcome_credentials";
type WelcomeRow = {
  id: string; user_id: string | null; recipient_email: string; first_name: string;
  app_language: string; encrypted_password: string | null; expires_at: string;
  ready_at: string | null; delivered_at: string | null;
};

function encryptionSecret() {
  return process.env.INRCY_SIGNUP_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function appOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://app.inrcy.com";
}

function welcomeError(code: string) {
  // Never include the provider payload, password, encrypted value or Auth user.
  return Object.assign(new Error(code), { code });
}

export async function prepareSignupWelcome(args: { email: string; firstName: string; language: string }) {
  // Fail before creating an Auth account if sending or persistence is unavailable.
  authResendApiKey();
  const credential = createTemporarySignupCredential();
  const { error } = await supabaseAdmin.from(TABLE).insert({
    id: credential.metadata.welcome_id,
    recipient_email: args.email,
    first_name: args.firstName,
    app_language: args.language,
    encrypted_password: sealSignupPassword(credential.password, credential.metadata.welcome_id, encryptionSecret()),
    created_at: credential.metadata.issued_at,
    expires_at: credential.metadata.expires_at,
  });
  if (error) throw welcomeError("signup_welcome_prepare_failed");
  return credential;
}

export async function attachSignupWelcome(welcomeId: string, userId: string) {
  const { data, error } = await supabaseAdmin.from(TABLE).update({ user_id: userId })
    .eq("id", welcomeId).is("user_id", null).select("id").single();
  if (error || !data) throw welcomeError("signup_welcome_attach_failed");
}

export async function completeSignupWelcome(welcomeId: string, userId: string) {
  const { data, error } = await supabaseAdmin.from(TABLE).update({ ready_at: new Date().toISOString() })
    .eq("id", welcomeId).eq("user_id", userId).select("id").single();
  if (error || !data) throw welcomeError("signup_welcome_complete_failed");
}

async function deliver(row: WelcomeRow) {
  if (!row.user_id || !row.ready_at || row.delivered_at || !row.encrypted_password) return { delivered: false };
  if (Date.parse(row.expires_at) <= Date.now()) return { delivered: false };
  // A user can change their password/email before a delayed worker runs. Never
  // send an obsolete credential, and never rotate any existing user's password.
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
  if (error || !data.user) throw welcomeError("signup_welcome_account_unavailable");
  const metadata = getTemporaryPasswordMetadata(data.user.app_metadata);
  if (metadata?.welcome_id !== row.id || String(data.user.email || "").toLowerCase() !== row.recipient_email.toLowerCase()) {
    const { error: cleanupError } = await supabaseAdmin.from(TABLE).update({ encrypted_password: null })
      .eq("id", row.id);
    if (cleanupError) throw welcomeError("signup_welcome_cleanup_failed");
    return { delivered: false };
  }
  const password = openSignupPassword(row.encrypted_password, row.id, encryptionSecret());
  if (!password) throw welcomeError("signup_welcome_credential_unavailable");
  const message = buildSignupWelcomeEmail({
    welcomeId: row.id, userId: row.user_id, email: row.recipient_email, firstName: row.first_name,
    language: row.app_language, password, expiresAt: row.expires_at, appOrigin: appOrigin(),
  });
  const result = await sendPreparedAuthEmail(message);
  // An ambiguous provider acceptance is reconciled by the existing webhook and
  // internal alert ledger. It must never cause a different credential to be sent.
  const { error: updateError } = await supabaseAdmin.from(TABLE).update({
    delivered_at: new Date().toISOString(), encrypted_password: null, lease_until: null,
  }).eq("id", row.id);
  if (updateError) throw welcomeError("signup_welcome_delivery_write_failed");
  return { delivered: true, uncertain: "uncertain" in result && Boolean(result.uncertain) };
}

export async function deliverSignupWelcome(welcomeId: string) {
  const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("id", welcomeId).single();
  if (error || !data) throw welcomeError("signup_welcome_lookup_failed");
  return deliver(data as WelcomeRow);
}

/** Called by the existing authenticated mail cron, without credentials in logs. */
export async function processPendingSignupWelcomes() {
  // Erase undelivered ciphertext at expiration, including orphan reservations.
  const { error: cleanupError } = await supabaseAdmin.from(TABLE).update({ encrypted_password: null })
    .lte("expires_at", new Date().toISOString()).not("encrypted_password", "is", null);
  if (cleanupError) throw welcomeError("signup_welcome_expiry_cleanup_failed");
  const { data, error } = await supabaseAdmin.rpc("claim_signup_welcome_credentials", { p_limit: 10 });
  if (error) throw welcomeError("signup_welcome_claim_failed");
  let delivered = 0;
  let failed = 0;
  for (const row of (data || []) as WelcomeRow[]) {
    try { if ((await deliver(row)).delivered) delivered++; }
    catch (error: unknown) {
      failed++;
      const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "signup_welcome_failed";
      console.error("[signup-welcome][deferred]", { welcome_id: row.id, code: code.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) });
      // Definitive rejection is already tracked/alerted by the auth mail ledger.
      // Erase the credential instead of repeatedly attempting a terminal send.
      if (code === "auth_mail_previous_terminal_failure") {
        await supabaseAdmin.from(TABLE).update({ blocked_at: new Date().toISOString(), encrypted_password: null }).eq("id", row.id);
      }
    }
  }
  return { delivered, failed };
}
