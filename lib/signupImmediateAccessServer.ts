import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sealSignupAccess, SIGNUP_ACCESS_TTL_SECONDS } from "./signupImmediateAccessPolicy.ts";
import type { TemporaryPasswordMetadata } from "./temporaryPasswordPolicy.ts";

export function signupAccessSecret() {
  return process.env.INRCY_SIGNUP_CREDENTIAL_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
/** Called only after a NEW user's complete provisioning, never by email lookup. */
export async function createSignupImmediateAccess(input: { userId: string; email: string; password: string; metadata: TemporaryPasswordMetadata; language: string }) {
  const issuedAt = Date.now();
  const expiresAt = Math.min(issuedAt + SIGNUP_ACCESS_TTL_SECONDS * 1000, Date.parse(input.metadata.expires_at));
  let ticket = "";
  let linkTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Generates a one-use provider credential without sending another email.
    // Immediate access is optional: a slow Auth provider must not hold the
    // successful WordPress signup beyond its own HTTP request deadline.
    const result = await Promise.race([
      supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: input.email }),
      new Promise<never>((_, reject) => {
        linkTimeout = setTimeout(() => reject(new Error("signup_access_link_timeout")), 2_500);
      }),
    ]);
    if (result.error || result.data.user?.id !== input.userId || !result.data.properties?.hashed_token) throw new Error("signup_access_link_unavailable");
    ticket = sealSignupAccess({ v: 1, userId: input.userId, email: input.email, password: input.password,
      welcomeId: input.metadata.welcome_id, language: input.language, tokenHash: result.data.properties.hashed_token,
      issuedAt, expiresAt }, signupAccessSecret());
  } catch {
    // The displayed temporary password remains a working manual fallback.
    console.error("[signup-access]", "automatic_access_unavailable");
  } finally {
    if (linkTimeout !== undefined) clearTimeout(linkTimeout);
  }
  return { email: input.email, password: input.password, ticket, expires_at: new Date(expiresAt).toISOString(),
    login_url: "https://app.inrcy.com/api/auth/signup-access" };
}
