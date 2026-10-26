import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { shouldBypassUpstashInCurrentEnv } from "../upstashMode.ts";

export type AccountDiagnosticEvent = {
  occurredAt: string;
  requestId: string;
  route: string;
  statusCode: number;
  errorCode: string;
};

type RequestScope = {
  requestId: string; route: string; actorUserId?: string; accountId?: string; errorCode?: string;
};

const scopes = new AsyncLocalStorage<RequestScope>();
const RETENTION_DAYS = 7 as const;
const MAX_EVENTS = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PUBLIC_CODES = new Set([
  "auth_required", "account_scope_unavailable", "subscription_required", "quota_exceeded",
  "assistant_unavailable", "assistant_invalid_request", "ai_gateway_rate_limit", "ai_gateway_unavailable",
  "ai_gateway_request_failed", "ai_gateway_invalid_request", "ai_gateway_account_limit_reached",
  "ai_operation_budget_exceeded", "ai_operation_deadline_exceeded", "ai_gateway_guard_unavailable",
  "ai_gateway_transcription_unavailable", "ai_gateway_transcription_protocol_unsupported", "fetch_timeout",
]);

function safeRoute(value: string): string | undefined {
  // No query, account identifier, secret-bearing path or administrator endpoint
  // can enter the assistant's per-account journal.
  const path = value.split(/[?#]/u, 1)[0];
  if (!/^\/api\//u.test(path) || /^\/api\/(?:admin|cron|auth|oauth|webhooks?|diagnostic)(?:\/|$)/iu.test(path)) return undefined;
  const segments = path.split("/").map(part => UUID.test(part) || /^\d+$/u.test(part) || part.length > 48 ? "[id]" : part);
  const route = segments.join("/");
  return route.length <= 220 && /^\/[a-z0-9_/[\]-]+$/iu.test(route) ? route : undefined;
}

function publicCode(value: unknown, statusCode: number): string {
  const code = typeof value === "string" ? value.toLowerCase() : "";
  return PUBLIC_CODES.has(code) ? code : `http_${statusCode}`;
}

function validEvent(value: unknown): value is AccountDiagnosticEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.occurredAt === "string" && Number.isFinite(Date.parse(row.occurredAt)) &&
    typeof row.requestId === "string" && UUID.test(row.requestId) &&
    typeof row.route === "string" && safeRoute(row.route) === row.route &&
    typeof row.statusCode === "number" && Number.isInteger(row.statusCode) && row.statusCode >= 400 && row.statusCode <= 599 &&
    typeof row.errorCode === "string" && (PUBLIC_CODES.has(row.errorCode) || row.errorCode === `http_${row.statusCode}`);
}

function getRedis(): Redis | null {
  if (shouldBypassUpstashInCurrentEnv()) return null;
  const url = String(process.env.KV_REST_API_URL || "").trim();
  const token = String(process.env.KV_REST_API_TOKEN || "").trim();
  return url && token ? new Redis({ url, token, retry: false, signal: () => AbortSignal.timeout(800) }) : null;
}

async function boundedReadOrWrite<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Diagnostic storage timed out")), 800);
        timer.unref?.();
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function journalKey(accountId: string) {
  if (!UUID.test(accountId)) throw new Error("Invalid diagnostic account scope");
  return `inrcy_diagnostics:v1:{${accountId.toLowerCase()}}:errors`;
}

const WRITE_EVENT = `
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

/** The scope is created by a server handler, then filled only by requireUser. */
export function runWithAccountDiagnosticContext<T>(args: { route: string; requestId?: string }, callback: () => T): T {
  return scopes.run({ route: args.route, requestId: UUID.test(args.requestId || "") ? args.requestId! : randomUUID() }, callback);
}

/** Never call this with model/client scope; use the resolved authentication result. */
export function registerAuthenticatedDiagnosticScope(args: { accountId: string; actorUserId: string }) {
  const scope = scopes.getStore();
  if (!scope || !UUID.test(args.accountId) || !UUID.test(args.actorUserId)) return;
  // A nested route may re-validate the same account, but cannot silently change
  // the authenticated tenant of the enclosing request's diagnostic context.
  if (scope.accountId && (scope.accountId !== args.accountId || scope.actorUserId !== args.actorUserId)) return;
  scope.accountId = args.accountId;
  scope.actorUserId = args.actorUserId;
}

export function noteAccountDiagnosticErrorCode(value: unknown) {
  const scope = scopes.getStore();
  if (scope && typeof value === "string" && PUBLIC_CODES.has(value.toLowerCase())) scope.errorCode = value.toLowerCase();
}

export function getAccountDiagnosticLogContext(): { request_id?: string; user_id?: string; account_id?: string } {
  const scope = scopes.getStore();
  return scope ? { request_id: scope.requestId, user_id: scope.actorUserId, account_id: scope.accountId } : {};
}

/** Best effort, bounded and never changes the outcome of the original request. */
export async function recordAccountDiagnosticError(args: {
  accountId: string; requestId: string; route: string; statusCode: number; errorCode?: unknown; occurredAt?: Date;
}): Promise<boolean> {
  const route = safeRoute(args.route);
  const date = args.occurredAt ?? new Date();
  if (!route || !UUID.test(args.accountId) || !UUID.test(args.requestId) || !Number.isFinite(date.getTime()) ||
    !Number.isInteger(args.statusCode) || args.statusCode < 400 || args.statusCode > 599) return false;
  const event: AccountDiagnosticEvent = {
    occurredAt: date.toISOString(), requestId: args.requestId, route,
    statusCode: args.statusCode, errorCode: publicCode(args.errorCode, args.statusCode),
  };
  try {
    const redis = getRedis();
    if (!redis) return false;
    await boundedReadOrWrite(redis.eval(WRITE_EVENT, [journalKey(args.accountId)], [JSON.stringify(event), MAX_EVENTS, RETENTION_DAYS * 86400]));
    return true;
  } catch { return false; }
}

export async function recordCurrentAccountDiagnosticError(statusCode: number, errorCode?: unknown): Promise<boolean> {
  const scope = scopes.getStore();
  if (!scope?.accountId) return false;
  return recordAccountDiagnosticError({
    accountId: scope.accountId, requestId: scope.requestId, route: scope.route,
    statusCode, errorCode: errorCode ?? scope.errorCode,
  });
}

/** The caller supplies the authenticated account; no global log search exists. */
export async function readAccountDiagnosticEvents(accountId: string): Promise<{
  available: boolean; events: AccountDiagnosticEvent[]; retentionDays: 7;
}> {
  const key = journalKey(accountId);
  try {
    const redis = getRedis();
    if (!redis) return { available: false, events: [], retentionDays: RETENTION_DAYS };
    const raw = await boundedReadOrWrite(redis.lrange<unknown>(key, 0, MAX_EVENTS - 1));
    const earliest = Date.now() - RETENTION_DAYS * 86400_000;
    const events: AccountDiagnosticEvent[] = [];
    for (const item of raw) {
      let row: unknown = item;
      try { if (typeof item === "string") row = JSON.parse(item); } catch { continue; }
      if (validEvent(row) && Date.parse(row.occurredAt) >= earliest && Date.parse(row.occurredAt) <= Date.now() + 60_000) {
        events.push({ occurredAt: row.occurredAt, requestId: row.requestId, route: row.route, statusCode: row.statusCode, errorCode: row.errorCode });
      }
    }
    return { available: true, events, retentionDays: RETENTION_DAYS };
  } catch { return { available: false, events: [], retentionDays: RETENTION_DAYS }; }
}
