import "server-only";

import crypto from "crypto";
import { requireEnv, optionalEnv } from "@/lib/env";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

function stripeKey() {
  return requireEnv("STRIPE_SECRET_KEY");
}

export function getAppUrl(req?: Request) {
  const explicit = optionalEnv("NEXT_PUBLIC_APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");

  // Fallback to request headers (works on Vercel / proxies)
  if (req) {
    const xfProto = req.headers.get("x-forwarded-proto");
    const xfHost = req.headers.get("x-forwarded-host");
    if (xfProto && xfHost) return `${xfProto}://${xfHost}`.replace(/\/$/, "");

    const host = req.headers.get("host");
    const proto = xfProto || "https";
    if (host) return `${proto}://${host}`.replace(/\/$/, "");
  }

  // Last resort: require env
  return requireEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
}

export async function stripePost(path: string, body: URLSearchParams, options?: { idempotencyKey?: string | null; apiVersion?: string }) {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      ...(options?.apiVersion ? { "Stripe-Version": options.apiVersion } : {}),
    },
    body,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = json?.error?.message || `Stripe error (${res.status})`;
    throw new Error(msg);
  }

  return json;
}

export async function stripeGet(path: string, options?: { apiVersion?: string }) {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      ...(options?.apiVersion ? { "Stripe-Version": options.apiVersion } : {}),
    },
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = json?.error?.message || `Stripe error (${res.status})`;
    throw new Error(msg);
  }

  return json;
}

/**
 * Minimal Stripe webhook verification (v1 signatures)
 * https://stripe.com/docs/webhooks/signatures
 */
export function verifyStripeWebhookSignature(payload: string, sigHeader: string | null) {
  const secret = requireEnv("STRIPE_WEBHOOK_SECRET");
  if (!sigHeader) throw new Error("Missing Stripe-Signature header");

  // Parse: t=...,v1=...,v1=...
  const parts = sigHeader.split(",").map((p) => p.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1="));

  const timestamp = tPart ? tPart.slice(2) : "";
  if (!timestamp || v1Parts.length === 0) throw new Error("Invalid Stripe-Signature header");

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const matches = v1Parts.some((p) => {
    const sig = p.slice(3);
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return false;
    }
  });

  if (!matches) throw new Error("Invalid Stripe signature");

  // Optional tolerance
  const toleranceSec = Number(optionalEnv("STRIPE_WEBHOOK_TOLERANCE_SEC", "300"));
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (Number.isFinite(ts) && toleranceSec > 0) {
    if (Math.abs(now - ts) > toleranceSec) throw new Error("Stripe signature timestamp outside tolerance");
  }

  return true;
}
