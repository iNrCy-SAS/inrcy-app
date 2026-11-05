import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { requireUser } from "./requireUser";
import { assistantActionFingerprint } from "./inrAssistantActionPreview.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
import { isInrAssistantDnaScheduleRequest } from "./inrAssistantBasicTargetIntents.ts";
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const schema = (properties: Record<string, JSONSchema7>): JSONSchema7 => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const config = (schedule: Row) => ({ enabled: schedule.enabled === true, dayOfMonth: schedule.dayOfMonth, time: schedule.time, timezone: schedule.timezone });
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides."); return input; }
export function createInrAssistantDnaScheduleTools(options: { request: Request; accountId: string; actorUserId: string; currentUserMessage: string; canStartWork?: () => boolean }) {
  const { request, accountId, actorUserId } = options, attempts = new Map<string, Promise<Row>>(), link = { label: "Analyse ADN", href: "/dashboard/adn-entreprise" };
  const fail = (status: string, message: string): Row => ({ ok: false, status, message, nextAction: link });
  const scope = async () => { if (request.signal.aborted || options.canStartWork?.() === false) return false; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId; };
  const read = async () => {
    if (!await scope()) throw new Error("Compte actif modifié.");
    const response = await (await import("@/app/api/ai-memory/analysis-schedule/route")).GET(), data = row(await response.json()), schedule = row(data.schedule);
    if (!response.ok || data.ok !== true || typeof schedule.enabled !== "boolean" || !Number.isInteger(schedule.dayOfMonth) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(str(schedule.time)) || !str(schedule.timezone)) throw new Error("Programmation indisponible.");
    const keys = ["enabled", "dayOfMonth", "time", "timezone", "nextRunAt", "lastStatus", "lastRunAt", "lastSuccessAt"];
    return Object.fromEntries(keys.map(key => [key, schedule[key] ?? null]));
  };
  return {
    readBusinessDnaSchedule: tool({ strict: true, description: "Lire la programmation mensuelle native de l’analyse ADN, disponible en Basique, sa date/heure/fuseau et l’état de la dernière exécution. Lecture seule, aucune analyse lancée et aucun quota contourné.", inputSchema: jsonSchema<Record<string, never>>(schema({})), execute: async raw => { fields(raw, []); try { const schedule = await read(); return { ok: true, status: "read", schedule, version: assistantActionFingerprint(config(schedule)), nextAction: link, message: "La programmation mensuelle ADN et son dernier état d’exécution ont été lus. Aucune programmation ni analyse n’a été modifiée." }; } catch { return fail("unavailable", "La programmation ADN n’est pas disponible. Le service natif ou sa configuration doit être vérifié."); } } }),
    updateBusinessDnaSchedule: tool({ strict: true, description: "Configurer, activer ou désactiver maintenant la programmation mensuelle native de l’analyse ADN. Jour du mois 1 à 28, heure HH:mm. Le fuseau reste celui de l’établissement et le serveur calcule la prochaine échéance. Relit les paramètres enregistrés ; ne déclenche aucune analyse immédiate. Conserver les valeurs lues si elles ne sont pas modifiées.",
      inputSchema: jsonSchema<{ enabled: boolean; dayOfMonth: number; time: string; expectedVersion: string; instructionQuote: string }>(schema({ enabled: { type: "boolean" }, dayOfMonth: { type: "integer", minimum: 1, maximum: 28 }, time: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" }, expectedVersion: { type: "string", pattern: "^[a-f0-9]{64}$" }, instructionQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["enabled", "dayOfMonth", "time", "expectedVersion", "instructionQuote"]), quote = str(input.instructionQuote), instruction = inrAssistantMaskQuotedText(quote).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(), instructionData = quote.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
        if (typeof input.enabled !== "boolean" || !Number.isInteger(input.dayOfMonth) || Number(input.dayOfMonth) < 1 || Number(input.dayOfMonth) > 28 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(str(input.time)) || !/^[a-f0-9]{64}$/.test(str(input.expectedVersion))) return fail("invalid_settings", "Programmation mensuelle invalide.");
        if (!isInrAssistantDnaScheduleRequest(options.currentUserMessage, quote)) return fail("needs_instruction", "Précisez la programmation mensuelle de l’analyse ADN à enregistrer. Programmer une publication à partir de l’ADN ne modifie pas cette programmation.");
        const key = JSON.stringify(input);
        if (!attempts.has(key)) attempts.set(key, (async () => {
          const before = await read(), proposed = { enabled: input.enabled, dayOfMonth: input.dayOfMonth, time: input.time, timezone: before.timezone };
          if (input.dayOfMonth !== before.dayOfMonth && !new RegExp(`(?:^|\\D)${input.dayOfMonth}(?:\\D|$)`).test(instructionData)) return fail("needs_details", "Précisez le jour du mois souhaité (1 à 28).");
          const [hours, minutes] = str(input.time).split(":"), timePattern = new RegExp(`\\b0?${Number(hours)}\\s*(?::\\s*${minutes}|${minutes === "00" ? "h(?:\\s*00)?" : `h\\s*${minutes}`})(?!\\d)`);
          if (input.time !== before.time && !timePattern.test(instructionData)) return fail("needs_details", "Précisez l’heure exacte de la programmation.");
          if (input.enabled !== before.enabled && !(input.enabled ? /\b(?:active|activer|programme|programmer|planifie|planifier)\b/ : /\b(?:desactive|desactiver|coupe|couper|arrete|arreter)\b/).test(instruction)) return fail("needs_instruction", "Précisez l’activation ou la désactivation de la programmation.");
          if (assistantActionFingerprint(config(before)) === assistantActionFingerprint(proposed)) return { ok: true, status: "already_applied", schedule: before, nextAction: link, message: "La programmation mensuelle ADN contient déjà les paramètres demandés. Aucune nouvelle écriture ni analyse n’a été effectuée." };
          if (assistantActionFingerprint(config(before)) !== input.expectedVersion) return fail("stale_preview", "La programmation ADN a changé. Relisez ses paramètres avant d’enregistrer.");
          if (!await scope()) return fail("blocked", "Le compte actif a changé.");
          const headers = new Headers({ "content-type": "application/json" }); for (const name of ["cookie", "authorization"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
          const response = await (await import("@/app/api/ai-memory/analysis-schedule/route")).PUT(new Request(new URL("/api/ai-memory/analysis-schedule", request.url), { method: "PUT", headers, signal: request.signal, body: JSON.stringify({ enabled: input.enabled, dayOfMonth: input.dayOfMonth, time: input.time }) })), data = row(await response.json());
          if (!response.ok || data.ok !== true) return fail(response.status === 503 ? "unavailable" : "unknown", "La programmation native n’a pas confirmé l’enregistrement.");
          const saved = await read(); if (assistantActionFingerprint(config(saved)) !== assistantActionFingerprint(proposed)) return fail("saved_unconfirmed", "La relecture ne confirme pas les paramètres de programmation ADN.");
          return { ok: true, status: "saved", schedule: saved, version: assistantActionFingerprint(config(saved)), nextAction: link, message: input.enabled ? "Programmation mensuelle enregistrée et vérifiée ; le serveur fournit sa prochaine échéance." : "Programmation mensuelle désactivée et vérifiée." };
        })().catch(() => fail("unknown", "Le résultat n’est pas confirmé. Consultez la programmation ADN avant de réessayer.")));
        return attempts.get(key)!;
      } }),
  };
}
