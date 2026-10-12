import { createHash } from "crypto";

export type JwtPayloadLike = {
  iss?: unknown;
  aud?: unknown;
  iat?: unknown;
  jti?: unknown;
  events?: unknown;
  [key: string]: unknown;
};

export type JwtHeaderLike = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
  [key: string]: unknown;
};

export type GoogleRiscEvent = {
  type: string;
  subjectType: string | null;
  providerAccountId: string | null;
  issuer: string | null;
  tokenType: string | null;
  tokenIdentifierAlg: string | null;
  tokenIdentifier: string | null;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function parseJwtPart<T extends Record<string, unknown>>(part: string, label: string): T {
  try {
    return JSON.parse(base64UrlToBuffer(part).toString("utf8")) as T;
  } catch {
    throw new Error(`google_risc_invalid_${label}`);
  }
}

export function parseJwt(token: string): { header: JwtHeaderLike; payload: JwtPayloadLike; signingInput: string; signature: Buffer } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("google_risc_invalid_jwt");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  return {
    header: parseJwtPart<JwtHeaderLike>(encodedHeader, "header"),
    payload: parseJwtPart<JwtPayloadLike>(encodedPayload, "payload"),
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: base64UrlToBuffer(encodedSignature),
  };
}

export function parseGoogleRiscEvents(payload: JwtPayloadLike): GoogleRiscEvent[] {
  const eventsRec = asRecord(payload.events);
  return Object.entries(eventsRec).map(([type, raw]) => {
    const rawRec = asRecord(raw);
    const subject = asRecord(rawRec["subject"]);
    return {
      type,
      subjectType: asString(subject["subject_type"]),
      providerAccountId: asString(subject["sub"]),
      issuer: asString(subject["iss"]),
      tokenType: asString(subject["token_type"]),
      tokenIdentifierAlg: asString(subject["token_identifier_alg"]),
      tokenIdentifier: asString(subject["token"]),
      raw: rawRec,
    } satisfies GoogleRiscEvent;
  });
}

export function extractSecurityEventToken(rawBody: string): string | null {
  const body = String(rawBody || "").trim();
  if (!body) return null;

  if (body.startsWith("eyJ") && body.split(".").length >= 3) return body;

  try {
    const parsed = JSON.parse(body) as unknown;
    const rec = asRecord(parsed);
    return asString(rec["jwt"]) || asString(rec["token"]) || asString(rec["security_event_token"]) || null;
  } catch {
    return null;
  }
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function sha256Base64(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function prefix16(value: string): string {
  return value.slice(0, 16);
}

export function tokenMatchesIdentifier(token: string, algRaw: string | null, identifierRaw: string | null): boolean {
  const identifier = String(identifierRaw || "").trim();
  if (!identifier) return false;
  const alg = String(algRaw || "").trim().toLowerCase();

  if (alg === "prefix") return prefix16(token) === identifier;
  if (["hash_sha256", "sha256", "hash_base64_sha256"].includes(alg)) {
    return sha256Base64Url(token) === identifier || sha256Base64(token) === identifier || sha256Hex(token) === identifier;
  }

  return false;
}

export type GoogleRiscStatusResult = {
  site_web: { ga4: boolean; gsc: boolean };
  gmb: boolean;
  gmail: boolean;
};

export function emptyGoogleRiscStatus(): GoogleRiscStatusResult {
  return {
    site_web: { ga4: false, gsc: false },
    gmb: false,
    gmail: false,
  };
}

export function buildGoogleRiscStatusFromRows(rows: unknown[]): GoogleRiscStatusResult {
  const result = emptyGoogleRiscStatus();

  for (const row of rows) {
    const rec = asRecord(row);
    const source = String(rec["source"] || "");
    const product = String(rec["product"] || "");
    const meta = asRecord(rec["meta"]);
    const reauthRequired = Boolean(asRecord(meta["risc"])["reauth_required"]);
    if (!reauthRequired) continue;

    if (source === "site_web" && product === "ga4") result.site_web.ga4 = true;
    else if (source === "site_web" && product === "gsc") result.site_web.gsc = true;
    else if (source === "gmb" && product === "gmb") result.gmb = true;
    else if (product === "gmail") result.gmail = true;
  }

  return result;
}
