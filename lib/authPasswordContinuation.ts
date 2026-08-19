import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const PASSWORD_FINISH_COOKIE = "inrcy_password_finish_v1";
export const PASSWORD_FINISH_CONTINUATION_TTL_SECONDS = 30 * 60;

const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const AAD = Buffer.from("inrcy-password-finish-continuation-v1", "utf8");

export type PasswordFinishMode = "invite" | "reset";

export type PasswordFinishSession = {
  access_token: string;
  refresh_token: string;
};

export type PasswordFinishContinuation = {
  mode: PasswordFinishMode;
  userId: string;
  email: string | null;
  session: PasswordFinishSession;
};

type SealedPayload = PasswordFinishContinuation & {
  version: typeof FORMAT_VERSION;
  expiresAt: number;
};

function resolveSecret(secret?: string) {
  const value = String(secret || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (value.length < 24) {
    throw new Error("Password continuation encryption secret is unavailable.");
  }
  return value;
}

function deriveKey(secret?: string) {
  return createHash("sha256")
    .update(resolveSecret(secret), "utf8")
    .update(AAD)
    .digest();
}

function isPlausibleToken(value: unknown, minLength: number) {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= 16_384 &&
    !/\s/.test(value)
  );
}

function isValidPayload(value: unknown): value is SealedPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SealedPayload>;
  return (
    payload.version === FORMAT_VERSION &&
    (payload.mode === "invite" || payload.mode === "reset") &&
    typeof payload.userId === "string" &&
    payload.userId.length >= 8 &&
    (payload.email === null || typeof payload.email === "string") &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt) &&
    payload.expiresAt > Date.now() &&
    isPlausibleToken(payload.session?.access_token, 20) &&
    // Supabase refresh tokens can legitimately be shorter than JWT access
    // tokens. Integrity comes from AES-GCM, then Supabase validates the token.
    isPlausibleToken(payload.session?.refresh_token, 6)
  );
}

export function sealPasswordFinishContinuation(
  continuation: PasswordFinishContinuation,
  secret?: string,
) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(AAD);

  const payload: SealedPayload = {
    ...continuation,
    version: FORMAT_VERSION,
    expiresAt: Date.now() + PASSWORD_FINISH_CONTINUATION_TTL_SECONDS * 1000,
  };
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

export function openPasswordFinishContinuation(
  sealed: string | null | undefined,
  expected: { mode: PasswordFinishMode; email?: string | null },
  secret?: string,
): PasswordFinishContinuation | null {
  try {
    if (!sealed || sealed.length > 12_000) return null;
    const packed = Buffer.from(sealed, "base64url");
    if (packed.length <= IV_LENGTH + AUTH_TAG_LENGTH) return null;

    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plaintext) as unknown;
    if (!isValidPayload(payload)) return null;
    if (payload.mode !== expected.mode) return null;

    const expectedEmail = String(expected.email || "").trim().toLowerCase();
    const payloadEmail = String(payload.email || "").trim().toLowerCase();
    if (expectedEmail && payloadEmail !== expectedEmail) return null;

    return {
      mode: payload.mode,
      userId: payload.userId,
      email: payload.email,
      session: payload.session,
    };
  } catch {
    return null;
  }
}
