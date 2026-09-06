import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const STATE_VERSION = 1;
const DEFAULT_TTL_SECONDS = 10 * 60;

export type VisioBookingOAuthState = {
  v: 1;
  adminUserId: string;
  nonce: string;
  iat: number;
  exp: number;
};

function sign(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizedSecret(secret: string) {
  const value = String(secret || "").trim();
  if (!value) throw new Error("visio_booking_oauth_secret_missing");
  return value;
}

export function getVisioBookingOAuthStateSecret() {
  return normalizedSecret(
    process.env.INRCY_VISIO_BOOKING_SECRET ||
      process.env.INRCY_TRIAL_SIGNUP_SECRET ||
      "",
  );
}

export function createVisioBookingOAuthState(input: {
  adminUserId: string;
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}) {
  const adminUserId = String(input.adminUserId || "").trim();
  if (!adminUserId) throw new Error("visio_booking_oauth_admin_missing");
  const secret = normalizedSecret(input.secret);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const ttlSeconds = Math.min(
    15 * 60,
    Math.max(60, Math.floor(input.ttlSeconds ?? DEFAULT_TTL_SECONDS)),
  );
  const payload: VisioBookingOAuthState = {
    v: STATE_VERSION,
    adminUserId,
    nonce: randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyVisioBookingOAuthState(input: {
  token: unknown;
  secret: string;
  now?: Date;
}) {
  const token = String(input.token || "").trim();
  const secret = normalizedSecret(input.secret);
  const [encoded, signature, extra] = token.split(".");
  if (
    !encoded ||
    !signature ||
    extra ||
    !safeEqual(signature, sign(encoded, secret))
  ) {
    return { ok: false as const, reason: "invalid_state" };
  }

  let state: VisioBookingOAuthState;
  try {
    state = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as VisioBookingOAuthState;
  } catch {
    return { ok: false as const, reason: "invalid_state" };
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (
    !state ||
    state.v !== STATE_VERSION ||
    !state.adminUserId ||
    !state.nonce ||
    !Number.isFinite(state.iat) ||
    !Number.isFinite(state.exp) ||
    state.iat > nowSeconds + 60
  ) {
    return { ok: false as const, reason: "invalid_state" };
  }
  if (state.exp <= nowSeconds) {
    return { ok: false as const, reason: "expired_state" };
  }
  return { ok: true as const, state };
}
