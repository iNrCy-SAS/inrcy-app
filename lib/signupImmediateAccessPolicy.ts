import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getTemporaryPasswordMetadata } from "./temporaryPasswordPolicy.ts";

export const SIGNUP_ACCESS_COOKIE = "inrcy_signup_access";
export const SIGNUP_ACCESS_TTL_SECONDS = 60 * 60;
const AAD = "inrcy-signup-access-v1";
export type SignupAccessClaims = {
  v: 1; userId: string; email: string; welcomeId: string; password: string;
  tokenHash: string; language: string; issuedAt: number; expiresAt: number;
};
function key(secret: string) {
  if (secret.length < 24) throw new Error("signup_access_unavailable");
  return createHash("sha256").update(AAD).update(secret).digest();
}
export function sealSignupAccess(claims: SignupAccessClaims, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(AAD));
  const data = Buffer.concat([cipher.update(JSON.stringify(claims), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function openSignupAccess(raw: unknown, secret: string, now = Date.now()): SignupAccessClaims | null {
  if (typeof raw !== "string" || raw.length < 50 || raw.length > 3500 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const bytes = Buffer.from(raw, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(secret), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(AAD)); decipher.setAuthTag(bytes.subarray(12, 28));
    const c = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as SignupAccessClaims;
    if (c.v !== 1 || !/^[0-9a-f-]{36}$/i.test(c.userId) || !/^[0-9a-f-]{36}$/i.test(c.welcomeId)
      || typeof c.email !== "string" || c.email.length > 254 || !c.email.includes("@")
      || typeof c.password !== "string" || c.password.length < 12 || c.password.length > 128
      || typeof c.tokenHash !== "string" || !/^[a-zA-Z0-9_-]{20,256}$/.test(c.tokenHash)
      || typeof c.language !== "string" || !/^[a-z]{2}$/.test(c.language)
      || !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt)
      || c.issuedAt > now + 60_000 || c.expiresAt <= now || c.expiresAt <= c.issuedAt
      || c.expiresAt - c.issuedAt > SIGNUP_ACCESS_TTL_SECONDS * 1000) return null;
    return c;
  } catch { return null; }
}
export function signupAccessMatchesUser(claims: SignupAccessClaims, user: { id: string; email?: string; app_metadata?: unknown }, now = Date.now()) {
  const metadata = getTemporaryPasswordMetadata(user.app_metadata);
  return user.id === claims.userId && user.email?.toLowerCase() === claims.email.toLowerCase()
    && metadata?.welcome_id === claims.welcomeId && Date.parse(metadata.expires_at) > now
    && Date.parse(metadata.issued_at) <= claims.issuedAt + 60_000;
}
