import "server-only";

import { createPublicKey, createVerify, type JsonWebKey } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { asRecord, asString, safeErrorMessage } from "@/lib/tsSafe";
import { log } from "@/lib/observability/logger";
import { tryDecryptToken } from "@/lib/oauthCrypto";
import {
  parseGoogleRiscEvents,
  parseJwt,
  tokenMatchesIdentifier,
  type GoogleRiscEvent,
  type JwtHeaderLike,
  type JwtPayloadLike,
} from "@/lib/security/googleRiscTestables";

const GOOGLE_RISC_CONFIG_URL = "https://accounts.google.com/.well-known/risc-configuration";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

type GoogleJwk = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
  kty?: string;
};

export { extractSecurityEventToken } from "@/lib/security/googleRiscTestables";

async function getGoogleJwks(jwksUrl: string): Promise<GoogleJwk[]> {
  const res = await fetch(jwksUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`google_risc_jwks_http_${res.status}`);
  const data = (await res.json()) as unknown;
  const keys = asRecord(data)["keys"];
  if (!Array.isArray(keys)) throw new Error("google_risc_jwks_invalid");
  return keys.map((k) => asRecord(k) as GoogleJwk);
}

export type GoogleRiscVerificationResult = {
  payload: JwtPayloadLike;
  header: JwtHeaderLike;
  events: GoogleRiscEvent[];
  jti: string | null;
  iat: number | null;
  iss: string | null;
  aud: string | string[] | null;
};

export type { GoogleRiscEvent } from "@/lib/security/googleRiscTestables";

export type GoogleRiscAction = {
  integrationIds: string[];
  providerAccountIds: string[];
  matchedBy: "provider_account_id" | "token_identifier" | "email_address" | "none";
  action: "logged_only" | "reauth_required" | "duplicate_ignored";
  eventTypes: string[];
  duplicate: boolean;
};

type IntegrationLookupRow = {
  id?: string | null;
  provider?: string | null;
  provider_account_id?: string | null;
  email_address?: string | null;
  account_email?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
};

function getAllowedAudiences(): string[] {
  const raw = [process.env.GOOGLE_CLIENT_ID || "", process.env.GOOGLE_RISC_AUDIENCES || ""]
    .filter(Boolean)
    .join(",");

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    )
  );
}

function isSevereEventType(eventType: string): boolean {
  return [
    "https://schemas.openid.net/secevent/risc/event-type/sessions-revoked",
    "https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked",
    "https://schemas.openid.net/secevent/risc/event-type/account-disabled",
    "https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required",
  ].includes(eventType);
}

export async function getGoogleRiscConfig(): Promise<{ issuer: string; jwks_uri: string }> {
  const res = await fetch(GOOGLE_RISC_CONFIG_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`google_risc_config_http_${res.status}`);
  const data = (await res.json()) as unknown;
  const rec = asRecord(data);
  const issuer = asString(rec["issuer"]);
  const jwks_uri = asString(rec["jwks_uri"]);
  if (!issuer || !jwks_uri) throw new Error("google_risc_config_invalid");
  return { issuer, jwks_uri };
}

function getAudienceList(aud: unknown): string[] {
  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud)) return aud.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return [];
}

function verifyJwtSignature(signingInput: string, signature: Buffer, header: JwtHeaderLike, jwk: GoogleJwk): void {
  const alg = asString(header.alg);
  if (alg !== "RS256") throw new Error("google_risc_unsupported_alg");

  const keyObject = createPublicKey({ key: jwk, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  const ok = verifier.verify(keyObject, signature);
  if (!ok) throw new Error("google_risc_invalid_signature");
}

export async function verifyGoogleSecurityEventToken(token: string): Promise<GoogleRiscVerificationResult> {
  const audiences = getAllowedAudiences();
  if (audiences.length === 0) throw new Error("google_risc_audience_missing");

  const cfg = await getGoogleRiscConfig();
  const { header, payload, signingInput, signature } = parseJwt(token);

  const iss = asString(payload.iss);
  if (!iss || !GOOGLE_ISSUERS.has(iss) || !GOOGLE_ISSUERS.has(cfg.issuer)) {
    throw new Error("google_risc_invalid_issuer");
  }

  const audList = getAudienceList(payload.aud);
  if (!audList.some((aud) => audiences.includes(aud))) {
    throw new Error("google_risc_invalid_audience");
  }

  const kid = asString(header.kid);
  if (!kid) throw new Error("google_risc_missing_kid");

  const jwks = await getGoogleJwks(cfg.jwks_uri);
  const jwk = jwks.find((key: GoogleJwk) => key.kid === kid);
  if (!jwk) throw new Error("google_risc_signing_key_not_found");

  verifyJwtSignature(signingInput, signature, header, jwk);

  return {
    payload,
    header,
    events: parseGoogleRiscEvents(payload),
    jti: asString(payload.jti),
    iat: typeof payload.iat === "number" ? payload.iat : null,
    iss,
    aud: typeof payload.aud === "string" || Array.isArray(payload.aud) ? (payload.aud as string | string[]) : null,
  };
}

async function insertSecurityEventLog(payload: Record<string, unknown>) {
  try {
    await supabaseAdmin.from("security_events_google").insert(payload);
  } catch (e) {
    log.warn("google_risc_log_insert_skipped", { error_message: safeErrorMessage(e) });
  }
}

async function isDuplicateJti(jti: string | null): Promise<boolean> {
  if (!jti) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("security_events_google")
      .select("id")
      .eq("provider", "google")
      .eq("jti", jti)
      .limit(1)
      .maybeSingle();
    if (error) return false;
    return Boolean(asString(asRecord(data)["id"]));
  } catch {
    return false;
  }
}

async function findIntegrationsByTokenIdentifier(events: GoogleRiscEvent[]): Promise<string[]> {
  const tokenEvents = events.filter((event) =>
    event.type === "https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked" &&
    event.tokenIdentifier &&
    event.tokenIdentifierAlg
  );

  if (!tokenEvents.length) return [];

  try {
    const { data, error } = await supabaseAdmin
      .from("integrations")
      .select("id,provider,provider_account_id,email_address,account_email,access_token_enc,refresh_token_enc")
      .in("provider", ["google", "gmail"]);

    if (error || !Array.isArray(data)) return [];

    const matched = new Set<string>();
    for (const rawRow of data as IntegrationLookupRow[]) {
      const row = asRecord(rawRow);
      const id = asString(row["id"]);
      if (!id) continue;
      const accessToken = tryDecryptToken(asString(row["access_token_enc"]));
      const refreshToken = tryDecryptToken(asString(row["refresh_token_enc"]));

      for (const event of tokenEvents) {
        if ((accessToken && tokenMatchesIdentifier(accessToken, event.tokenIdentifierAlg, event.tokenIdentifier)) ||
            (refreshToken && tokenMatchesIdentifier(refreshToken, event.tokenIdentifierAlg, event.tokenIdentifier))) {
          matched.add(id);
        }
      }
    }

    return Array.from(matched);
  } catch {
    return [];
  }
}

export async function persistGoogleRiscEvent(opts: {
  verified: GoogleRiscVerificationResult;
  rawToken: string;
  requestId?: string;
}) {
  const { verified, requestId } = opts;
  const eventTypes = verified.events.map((e) => e.type);
  const providerAccountIds = Array.from(
    new Set(verified.events.map((e) => e.providerAccountId).filter((v): v is string => Boolean(v)))
  );

  if (await isDuplicateJti(verified.jti)) {
    log.info("google_risc_duplicate_ignored", { request_id: requestId, jti: verified.jti, event_types: eventTypes });
    return {
      eventTypes,
      providerAccountIds,
      integrationIds: [],
      matchedBy: "none",
      action: "duplicate_ignored",
      duplicate: true,
    } satisfies GoogleRiscAction;
  }

  let integrationIds: string[] = [];
  let matchedBy: GoogleRiscAction["matchedBy"] = "none";

  if (providerAccountIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("integrations")
      .select("id,provider_account_id")
      .in("provider", ["google", "gmail"])
      .in("provider_account_id", providerAccountIds);

    integrationIds = Array.from(new Set((data || []).map((row) => String(asRecord(row)["id"] || "")).filter(Boolean)));
    matchedBy = integrationIds.length > 0 ? "provider_account_id" : "none";
  }

  if (!integrationIds.length) {
    const tokenMatchedIds = await findIntegrationsByTokenIdentifier(verified.events);
    if (tokenMatchedIds.length > 0) {
      integrationIds = tokenMatchedIds;
      matchedBy = "token_identifier";
    }
  }

  const severe = verified.events.some((e) => isSevereEventType(e.type));
  const action: GoogleRiscAction["action"] = severe && integrationIds.length > 0 ? "reauth_required" : "logged_only";

  await insertSecurityEventLog({
    provider: "google",
    request_id: requestId ?? null,
    jti: verified.jti,
    iat: verified.iat,
    iss: verified.iss,
    aud: verified.aud,
    event_types: eventTypes,
    provider_account_ids: providerAccountIds,
    integration_ids: integrationIds,
    matched_by: matchedBy,
    action,
    payload: verified.payload,
    received_at: new Date().toISOString(),
  });

  if (action === "reauth_required") {
    const { data: currentRows } = await supabaseAdmin.from("integrations").select("id,meta").in("id", integrationIds);

    for (const row of currentRows || []) {
      const rec = asRecord(row);
      const meta = asRecord(rec["meta"]);
      const nextMeta = {
        ...meta,
        risc: {
          ...asRecord(meta["risc"]),
          reauth_required: true,
          last_event_types: eventTypes,
          last_jti: verified.jti,
          last_iat: verified.iat,
          last_received_at: new Date().toISOString(),
        },
      };

      await supabaseAdmin
        .from("integrations")
        .update({
          status: "expired",
          access_token_enc: null,
          refresh_token_enc: null,
          expires_at: new Date(0).toISOString(),
          meta: nextMeta,
        })
        .eq("id", String(rec["id"] || ""));
    }
  }

  log.info("google_risc_event_processed", {
    request_id: requestId,
    provider: "google",
    event_types: eventTypes,
    provider_account_ids: providerAccountIds,
    integration_ids: integrationIds,
    matched_by: matchedBy,
    action,
  });

  return {
    eventTypes,
    providerAccountIds,
    integrationIds,
    matchedBy,
    action,
    duplicate: false,
  } satisfies GoogleRiscAction;
}

export function decodeGoogleSecurityEventTokenUnsafe(token: string) {
  const { header, payload } = parseJwt(token);
  return { header, payload };
}

export async function getGoogleRiscHealthReport() {
  const audiences = getAllowedAudiences();
  const cfg = await getGoogleRiscConfig();
  const jwks = await getGoogleJwks(cfg.jwks_uri);

  let dbOk = false;
  try {
    const { error } = await supabaseAdmin.from("security_events_google").select("id").limit(1);
    dbOk = !error;
  } catch {
    dbOk = false;
  }

  return {
    ok: Boolean(process.env.GOOGLE_RISC_RECEIVER_ENABLED === "1" && audiences.length > 0 && dbOk && jwks.length > 0),
    receiver_enabled: process.env.GOOGLE_RISC_RECEIVER_ENABLED === "1",
    audiences_count: audiences.length,
    issuer: cfg.issuer,
    jwks_count: jwks.length,
    security_events_table_ok: dbOk,
    checked_at: new Date().toISOString(),
  };
}
