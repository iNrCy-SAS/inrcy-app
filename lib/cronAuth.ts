import "server-only";

import { optionalEnv } from "@/lib/env";

export function getCronSecret() {
  return process.env.VERCEL_CRON_SECRET || process.env.CRON_SECRET || "";
}

export function isAuthorizedCronRequest(req: Request) {
  const cronSecrets = [process.env.VERCEL_CRON_SECRET, process.env.CRON_SECRET]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (cronSecrets.length === 0) return false;

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
  const querySecret = new URL(req.url).searchParams.get("secret") || "";

  return cronSecrets.some(
    (cronSecret) =>
      bearer === cronSecret ||
      headerSecret === cronSecret ||
      querySecret === cronSecret,
  );
}

export function getCronUserIdFromRequest(req: Request, body?: Record<string, unknown> | null) {
  const headerUserId = (req.headers.get("x-inr-agent-user-id") || req.headers.get("x-cron-user-id") || "").trim();
  const bodyUserId = typeof body?.cronUserId === "string" ? body.cronUserId.trim() : "";
  const queryUserId = new URL(req.url).searchParams.get("userId") || "";
  const userId = bodyUserId || headerUserId || queryUserId.trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return "";
  }

  return userId;
}

export function buildInternalCronHeaders(userId: string) {
  const secret = getCronSecret();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-inr-agent-user-id": userId,
  };

  if (secret) {
    headers["x-cron-secret"] = secret;
    headers.authorization = `Bearer ${secret}`;
  }

  return headers;
}

export function getAppOriginFromRequest(req: Request) {
  const envOrigin = optionalEnv("NEXT_PUBLIC_APP_URL", optionalEnv("NEXT_PUBLIC_SITE_URL", "")).replace(/\/$/, "");
  if (envOrigin) return envOrigin;
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
