import "server-only";

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";

const DEFAULT_AUTH_BACKOFF_SECONDS = 60 * 60;
const MIN_AUTH_BACKOFF_SECONDS = 5 * 60;
const MAX_AUTH_BACKOFF_SECONDS = 24 * 60 * 60;

type GlobalWithTxSmtpCircuit = typeof globalThis & {
  __inrcy_tx_smtp_circuit_redis?: Redis;
  __inrcy_tx_smtp_circuit_local?: Map<string, number>;
};

export type TxSmtpCircuitIdentity = {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
};

export class TxSmtpCircuitOpenError extends Error {
  readonly code = "TX_SMTP_AUTH_BACKOFF";

  constructor() {
    super(
      "Envoi SMTP temporairement suspendu après un refus d’authentification. Corrigez les identifiants SMTP avant une nouvelle tentative.",
    );
    this.name = "TxSmtpCircuitOpenError";
  }
}

function authBackoffSeconds() {
  const configured = Number(process.env.TX_SMTP_AUTH_BACKOFF_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_AUTH_BACKOFF_SECONDS;
  return Math.min(
    MAX_AUTH_BACKOFF_SECONDS,
    Math.max(MIN_AUTH_BACKOFF_SECONDS, Math.floor(configured)),
  );
}

function smtpConfigurationFingerprint(identity?: TxSmtpCircuitIdentity) {
  const host = String(identity?.host || process.env.TX_SMTP_HOST || "")
    .trim()
    .toLowerCase();
  const port = String(identity?.port || process.env.TX_SMTP_PORT || "").trim();
  const user = String(identity?.user || process.env.TX_SMTP_USER || "")
    .trim()
    .toLowerCase();
  const pass = String(identity?.pass || process.env.TX_SMTP_PASS || "");
  const secure = String(
    identity ? identity.secure : process.env.TX_SMTP_SECURE || "",
  )
    .trim()
    .toLowerCase();
  if (!host || !port || !user || !pass) return "";

  // The password never leaves this process. Including its digest means that a
  // Vercel credential rotation immediately bypasses the previous open circuit.
  return createHash("sha256")
    .update([host, port, user, pass, secure].join("\0"))
    .digest("hex")
    .slice(0, 24);
}

function circuitKey(fingerprint: string) {
  return `tx-smtp:auth-backoff:${fingerprint}`;
}

function getLocalCircuits() {
  const globalCache = globalThis as GlobalWithTxSmtpCircuit;
  return (globalCache.__inrcy_tx_smtp_circuit_local ||= new Map());
}

function getRedis() {
  if (shouldBypassUpstashInCurrentEnv()) return null;
  const url = String(process.env.KV_REST_API_URL || "").trim();
  const token = String(process.env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) return null;

  const globalCache = globalThis as GlobalWithTxSmtpCircuit;
  if (!globalCache.__inrcy_tx_smtp_circuit_redis) {
    globalCache.__inrcy_tx_smtp_circuit_redis = new Redis({ url, token });
  }
  return globalCache.__inrcy_tx_smtp_circuit_redis;
}

export function isTxSmtpAuthenticationFailure(error: unknown) {
  const candidate = error as {
    code?: unknown;
    responseCode?: unknown;
    response?: unknown;
    message?: unknown;
  } | null;
  const code = String(candidate?.code || "").trim().toUpperCase();
  const responseCode = Number(candidate?.responseCode || 0);
  const message = `${candidate?.message || ""} ${candidate?.response || ""}`.toLowerCase();

  return (
    code === "EAUTH" ||
    responseCode === 535 ||
    /(?:535\s+5\.7|authentication failed|invalid login|invalid credentials|account (?:is )?(?:blocked|suspended)|blocked for spam|spam detected)/i.test(
      message,
    )
  );
}

export function isTxSmtpCircuitOpenError(error: unknown) {
  const candidate = error as { code?: unknown; name?: unknown } | null;
  return (
    error instanceof TxSmtpCircuitOpenError ||
    candidate?.code === "TX_SMTP_AUTH_BACKOFF" ||
    candidate?.name === "TxSmtpCircuitOpenError"
  );
}

export async function assertTxSmtpCircuitClosed(
  identity?: TxSmtpCircuitIdentity,
) {
  const fingerprint = smtpConfigurationFingerprint(identity);
  if (!fingerprint) return;

  const key = circuitKey(fingerprint);
  const now = Date.now();
  const localCircuits = getLocalCircuits();
  const localUntil = localCircuits.get(key) || 0;
  if (localUntil > now) throw new TxSmtpCircuitOpenError();
  if (localUntil) localCircuits.delete(key);

  const redis = getRedis();
  if (!redis) return;
  try {
    const remoteUntil = Number(await redis.get<string | number>(key));
    if (Number.isFinite(remoteUntil) && remoteUntil > now) {
      localCircuits.set(key, remoteUntil);
      throw new TxSmtpCircuitOpenError();
    }
  } catch (error) {
    if (isTxSmtpCircuitOpenError(error)) throw error;
    // Availability wins if the guard backend itself is unavailable.
  }
}

export async function openTxSmtpCircuit(
  error: unknown,
  identity?: TxSmtpCircuitIdentity,
) {
  if (!isTxSmtpAuthenticationFailure(error)) return false;
  const fingerprint = smtpConfigurationFingerprint(identity);
  if (!fingerprint) return false;

  const seconds = authBackoffSeconds();
  const until = Date.now() + seconds * 1_000;
  const key = circuitKey(fingerprint);
  getLocalCircuits().set(key, until);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, String(until), { ex: seconds });
    } catch {
      // The warm-instance fallback still prevents an immediate retry storm.
    }
  }
  return true;
}

export async function clearTxSmtpCircuit(identity?: TxSmtpCircuitIdentity) {
  const fingerprint = smtpConfigurationFingerprint(identity);
  if (!fingerprint) return;

  const key = circuitKey(fingerprint);
  getLocalCircuits().delete(key);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // A successful SMTP operation is authoritative even if Redis is unavailable.
  }
}
