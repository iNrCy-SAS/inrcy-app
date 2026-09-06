import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { optionalEnv, requireEnv } from "@/lib/env";

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 2 * 60 * 60;

export type VisioBookingClaims = {
  v: 1;
  sub: string;
  email: string;
  nonce: string;
  iat: number;
  exp: number;
};

function secret() {
  return optionalEnv("INRCY_VISIO_BOOKING_SECRET", "").trim() ||
    requireEnv("INRCY_TRIAL_SIGNUP_SECRET");
}

function sign(encodedPayload: string) {
  return createHmac("sha256", secret())
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createVisioBookingToken(input: {
  userId: string;
  email: string;
  now?: Date;
  ttlSeconds?: number;
}) {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const configuredTtl = Number(
    optionalEnv("INRCY_VISIO_BOOKING_TOKEN_TTL_SECONDS", String(DEFAULT_TTL_SECONDS)),
  );
  const ttlSeconds = Math.min(
    24 * 60 * 60,
    Math.max(
      15 * 60,
      Math.floor(
        input.ttlSeconds ??
          (Number.isFinite(configuredTtl) ? configuredTtl : DEFAULT_TTL_SECONDS),
      ),
    ),
  );
  const payload: VisioBookingClaims = {
    v: TOKEN_VERSION,
    sub: input.userId,
    email: input.email.trim().toLowerCase(),
    nonce: randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyVisioBookingToken(rawToken: unknown, now = new Date()) {
  const token = String(rawToken || "").trim();
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded))) {
    throw new Error("visio_booking_token_invalid");
  }

  let claims: VisioBookingClaims;
  try {
    claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as VisioBookingClaims;
  } catch {
    throw new Error("visio_booking_token_invalid");
  }

  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (
    !claims ||
    typeof claims !== "object" ||
    claims.v !== TOKEN_VERSION ||
    !claims.sub ||
    !claims.email ||
    !claims.nonce ||
    !Number.isFinite(claims.iat) ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= nowSeconds ||
    claims.iat > nowSeconds + 60
  ) {
    throw new Error(
      claims && Number.isFinite(claims.exp) && claims.exp <= nowSeconds
        ? "visio_booking_token_expired"
        : "visio_booking_token_invalid",
    );
  }

  return claims;
}
