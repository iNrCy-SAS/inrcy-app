import "server-only";

import { createHmac } from "node:crypto";

const DEFAULT_PURGE_URL = "https://inrcy.com/wp-json/inrcy/v1/directory-cache/purge";
const PURGE_TIMEOUT_MS = 5_000;
const PURGE_ATTEMPTS = 2;

export type InrSearchDirectoryPurgeReason =
  | "connect"
  | "disconnect"
  | "directory_enabled"
  | "directory_disabled"
  | "profile_updated"
  | "admin_access_changed";

export type InrSearchDirectoryPurgeResult = {
  ok: true;
  cacheVersion: number | null;
};

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max).trim();
}

function purgeUrl() {
  return clean(process.env.INRCY_DIRECTORY_PURGE_URL, 1_000) || DEFAULT_PURGE_URL;
}

function purgeSecret() {
  return clean(process.env.INRCY_DIRECTORY_PURGE_SECRET, 1_000);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Erreur inconnue");
}

export async function purgeInrSearchDirectoryCache(args: {
  reason: InrSearchDirectoryPurgeReason;
  slug?: string;
}): Promise<InrSearchDirectoryPurgeResult> {
  const secret = purgeSecret();
  if (secret.length < 32) {
    throw new Error("INRCY_DIRECTORY_PURGE_SECRET doit contenir au moins 32 caractères.");
  }

  const body = JSON.stringify({
    source: "inrcy-app",
    reason: args.reason,
    slug: clean(args.slug, 160),
    changedAt: new Date().toISOString(),
  });
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= PURGE_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(purgeUrl(), {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-iNrCy-Timestamp": timestamp,
          "X-iNrCy-Signature": signature,
        },
        body,
        signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok || payload?.ok !== true) {
        const detail = clean(payload?.message || payload?.code, 240);
        throw new Error(`Purge WordPress refusée (${response.status})${detail ? ` : ${detail}` : ""}.`);
      }

      const cacheVersion = Number(payload.cacheVersion);
      return {
        ok: true,
        cacheVersion: Number.isSafeInteger(cacheVersion) ? cacheVersion : null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Purge du cache de l’annuaire impossible : ${errorMessage(lastError)}`);
}
