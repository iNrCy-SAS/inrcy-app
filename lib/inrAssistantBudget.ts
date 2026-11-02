import "server-only";
import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { shouldBypassUpstashInCurrentEnv } from "./upstashMode.ts";

/** Cost ceilings, not customer credits. Founder shares the Premium ceiling. */
export const INR_ASSISTANT_MONTHLY_BUDGET_MICRO_EUR: Readonly<Record<DashboardEdition, number>> = Object.freeze({ basic: 5_000_000, standard: 7_500_000, premium: 10_000_000, founder: 10_000_000 });
// Deliberately conservative bookkeeping conversion, NOT an exchange-rate quote.
// At implementation ECB 2026-10-29: 1 EUR = 1.1130 USD. Charging each estimated
// USD as 1.25 EUR also retains room for FX/payment costs. Deployment can only
// raise this protection. Provider token tariffs already include guard margins.
export function assistantCostMicroEur(costMicroUsd: number): number {
  if (!Number.isSafeInteger(costMicroUsd) || costMicroUsd < 0) throw new Error("Invalid assistant cost");
  const configured = Number(process.env.INR_ASSISTANT_EUR_PER_USD_GUARD);
  const factor = Number.isFinite(configured) && configured >= 1.25 && configured <= 10 ? configured : 1.25;
  const result = Math.ceil(costMicroUsd * factor);
  if (!Number.isSafeInteger(result)) throw new Error("Invalid assistant cost");
  return result;
}
const TTL = 70 * 24 * 60 * 60;
export const RESERVE_ASSISTANT_BUDGET_SCRIPT = `
local cost = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if not used or used < 0 or used ~= math.floor(used) or not cost or cost < 1 or not cap or cap < 1 then return -1 end
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
if used + cost > cap then return 0 end
redis.call('INCRBY', KEYS[1], cost)
redis.call('HSET', KEYS[2], 'state', 'reserved', 'cost', cost)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1
`;
export const FINALIZE_ASSISTANT_BUDGET_SCRIPT = `
local state = redis.call('HGET', KEYS[2], 'state')
if state == 'finalized' then return 1 end
if state ~= 'reserved' then return -1 end
local reserved = tonumber(redis.call('HGET', KEYS[2], 'cost'))
local used = tonumber(redis.call('GET', KEYS[1]))
local actual = tonumber(ARGV[1])
if not reserved or not used or used < reserved or not actual or actual < 0 then return -1 end
redis.call('INCRBY', KEYS[1], actual - reserved)
redis.call('HSET', KEYS[2], 'state', 'finalized', 'actual', actual)
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[2])
return 1
`;
export class InrAssistantBudgetLimitError extends Error {
  code = "assistant_monthly_budget_reached";
  constructor() { super("Le budget mensuel iNrAssist de ce compte est atteint. Les appels IA reprendront au début du mois prochain. Vous pouvez toujours ouvrir les outils et les utiliser directement."); }
}
export class InrAssistantBudgetUnavailableError extends Error {
  code = "assistant_budget_unavailable";
  constructor() { super("Le budget iNrAssist ne peut pas être vérifié. Aucun appel IA supplémentaire n’a été lancé."); }
}
type BudgetRedis = Pick<Redis, "eval">;
export type InrAssistantBudgetReservation = { keys: [string, string]; reservedMicroEur: number; factor: number; local: boolean };
const localUsage = new Map<string, number>();
const localReservations = new Map<string, "reserved" | "finalized">();
function client(): BudgetRedis | null {
  if (shouldBypassUpstashInCurrentEnv() && process.env.NODE_ENV !== "production") return null;
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new InrAssistantBudgetUnavailableError();
  const shared = globalThis as typeof globalThis & { __inrcy_assistant_budget_redis?: Redis };
  return shared.__inrcy_assistant_budget_redis ??= new Redis({ url, token });
}
export async function reserveInrAssistantBudget(args: { accountId: string; edition: DashboardEdition; estimatedCostMicroUsd: number; now?: Date }): Promise<InrAssistantBudgetReservation> {
  const cap = INR_ASSISTANT_MONTHLY_BUDGET_MICRO_EUR[args.edition];
  if (!cap || !args.accountId || args.accountId.length > 180 || !Number.isSafeInteger(args.estimatedCostMicroUsd) || args.estimatedCostMicroUsd < 1) throw new InrAssistantBudgetUnavailableError();
  const now = args.now ?? new Date(); if (!Number.isFinite(now.getTime())) throw new InrAssistantBudgetUnavailableError();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  // Actor, conversation and edition are deliberately absent: changing any of
  // these cannot replenish a single account's consumed monthly budget.
  const prefix = `inrcy_assistant_budget:v1:{${encodeURIComponent(args.accountId)}:${month}}`;
  const reservedMicroEur = assistantCostMicroEur(args.estimatedCostMicroUsd);
  const redis = client();
  const reservation: InrAssistantBudgetReservation = { keys: [`${prefix}:used`, `${prefix}:${randomUUID()}`], reservedMicroEur, factor: assistantCostMicroEur(1_000_000) / 1_000_000, local: !redis };
  if (!redis) {
    const used = localUsage.get(reservation.keys[0]) ?? 0;
    if (used + reservedMicroEur > cap) throw new InrAssistantBudgetLimitError();
    localUsage.set(reservation.keys[0], used + reservedMicroEur); localReservations.set(reservation.keys[1], "reserved");
    return reservation;
  }
  let granted: unknown;
  try { granted = await redis.eval(RESERVE_ASSISTANT_BUDGET_SCRIPT, reservation.keys, [reservedMicroEur, cap, TTL]); } catch { throw new InrAssistantBudgetUnavailableError(); }
  if (Number(granted) === 0) throw new InrAssistantBudgetLimitError();
  if (Number(granted) !== 1) throw new InrAssistantBudgetUnavailableError();
  return reservation;
}
/** Unknown provider outcome retains its full reservation. Only confirmed usage
 * or a call definitely never sent may release capacity; finalization is atomic. */
export async function finalizeInrAssistantBudget(reservation: InrAssistantBudgetReservation, actualCostMicroUsd?: number): Promise<void> {
  if (actualCostMicroUsd !== undefined && (!Number.isSafeInteger(actualCostMicroUsd) || actualCostMicroUsd < 0)) throw new InrAssistantBudgetUnavailableError();
  const actual = actualCostMicroUsd === undefined ? reservation.reservedMicroEur : Math.ceil(actualCostMicroUsd * reservation.factor);
  if (!Number.isSafeInteger(actual) || actual < 0) throw new InrAssistantBudgetUnavailableError();
  if (reservation.local) {
    if (localReservations.get(reservation.keys[1]) === "finalized") return;
    if (localReservations.get(reservation.keys[1]) !== "reserved") throw new InrAssistantBudgetUnavailableError();
    localUsage.set(reservation.keys[0], (localUsage.get(reservation.keys[0]) ?? 0) + actual - reservation.reservedMicroEur);
    localReservations.set(reservation.keys[1], "finalized");
    if (actual > reservation.reservedMicroEur) throw new InrAssistantBudgetUnavailableError();
    return;
  }
  const redis = client(); if (!redis) throw new InrAssistantBudgetUnavailableError();
  try { if (Number(await redis.eval(FINALIZE_ASSISTANT_BUDGET_SCRIPT, reservation.keys, [actual, TTL])) !== 1) throw new Error("Unavailable budget"); }
  catch { throw new InrAssistantBudgetUnavailableError(); }
  if (actual > reservation.reservedMicroEur) throw new InrAssistantBudgetUnavailableError();
}
