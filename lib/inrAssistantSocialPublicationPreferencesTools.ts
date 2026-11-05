import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { requireUser } from "./requireUser";
import { assistantActionFingerprint } from "./inrAssistantActionPreview.ts";
import { isInrAssistantSocialPreferencesRequest } from "./inrAssistantBasicTargetIntents.ts";
import { parseFacebookPublicationPreferencesPatch } from "./facebookPublicationPreferences";
import { parseInstagramPublicationPreferencesPatch } from "./instagramPublicationPreferences";
import { parseThreadsPublicationPreferencesPatch } from "./threadsPublicationPreferences";
type Row = Record<string, unknown>;
type Channel = "facebook" | "instagram" | "threads";
const CHANNELS: Channel[] = ["facebook", "instagram", "threads"];
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const norm = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const schema = (properties: Record<string, JSONSchema7>): JSONSchema7 => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides."); return input; }
function nativeRequest(source: Request, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "content-type": "application/json" }); for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); }
  return new Request(new URL(path, source.url), { headers, method, signal: source.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function authorized(message: string, quote: string, channel: Channel) {
  return isInrAssistantSocialPreferencesRequest(message, channel, quote);
}
export function createInrAssistantSocialPublicationPreferencesTools(options: { request: Request; accountId: string; actorUserId: string; currentUserMessage: string; canStartWork?: () => boolean }) {
  const { request, accountId, actorUserId } = options, attempts = new Map<string, Promise<Row>>();
  const link = (channel: Channel) => ({ label: "Formats de publication", href: `/dashboard?panel=${channel}` });
  const fail = (status: string, message: string, channel: Channel): Row => ({ ok: false, status, message, nextAction: link(channel) });
  const scope = async () => { if (request.signal.aborted || options.canStartWork?.() === false) return false; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId; };
  const api = async (channel: Channel) => channel === "facebook" ? import("@/app/api/integrations/facebook/publication-preferences/route") : channel === "instagram" ? import("@/app/api/integrations/instagram/publication-preferences/route") : import("@/app/api/integrations/threads/publication-preferences/route");
  const read = async (channel: Channel) => {
    if (!await scope()) throw new Error("Compte actif modifié.");
    const response = await (await api(channel)).GET(nativeRequest(request, `/api/integrations/${channel}/publication-preferences`)), data = row(await response.json());
    if (!response.ok || data.ok !== true) throw new Error("Préférences indisponibles.");
    const preferences = row(data.preferences), keys = channel === "threads" ? ["version", "ghostEnabled", "defaultMode"] : ["version", "reelsEnabled", "storiesEnabled", "defaultMode"];
    return Object.fromEntries(keys.map(key => [key, preferences[key]]));
  };
  return {
    readSocialPublicationPreferences: tool({ strict: true, description: "Lire les préférences globales de formats Facebook/Instagram (Reels, Stories et format par défaut) ou Threads (Ghost et format par défaut). Le contrôle natif conserve ses droits de canal et de pilote Threads. Ne publie rien.", inputSchema: jsonSchema<{ channel: Channel }>(schema({ channel: { type: "string", enum: CHANNELS } })), execute: async raw => {
      const input = fields(raw, ["channel"]), channel = str(input.channel) as Channel; if (!CHANNELS.includes(channel)) return { ok: false, status: "invalid_settings" };
      try { const preferences = await read(channel); return { ok: true, status: "read", channel, preferences, version: assistantActionFingerprint(preferences), nextAction: link(channel), message: "Les préférences globales de formats du canal ont été lues. Aucun réglage ni publication n’a été modifié." }; } catch { return fail("unavailable", "Les préférences ne sont pas accessibles. Vérifiez le canal et ses autorisations.", channel); }
    } }),
    updateSocialPublicationPreferences: tool({ strict: true, description: "Modifier uniquement les préférences globales de formats demandées maintenant. Champs Facebook/Instagram : reelsEnabled/storiesEnabled booléens, defaultMode classic/reel/story ; Threads : ghostEnabled et defaultMode classic/ghost. Les autres choix sont conservés. Applique le normaliseur natif : désactiver le format par défaut le rétablit en Classique. Aucun post envoyé, aucun compte connecté.",
      inputSchema: jsonSchema<{ channel: Channel; expectedVersion: string; changes: Array<{ field: string; value: string | boolean }>; instructionQuote: string }>(schema({ channel: { type: "string", enum: CHANNELS }, expectedVersion: { type: "string", pattern: "^[a-f0-9]{64}$" }, changes: { type: "array", minItems: 1, maxItems: 3, items: schema({ field: { type: "string", enum: ["reelsEnabled", "storiesEnabled", "ghostEnabled", "defaultMode"] }, value: { type: ["boolean", "string"], maxLength: 20 } }) }, instructionQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["channel", "expectedVersion", "changes", "instructionQuote"]), channel = str(input.channel) as Channel;
        if (!CHANNELS.includes(channel) || !/^[a-f0-9]{64}$/.test(str(input.expectedVersion)) || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 3) return { ok: false, status: "invalid_settings" };
        if (!authorized(options.currentUserMessage, str(input.instructionQuote), channel)) return fail("needs_instruction", "Précisez le canal et les préférences à modifier dans votre demande actuelle.", channel);
        const key = JSON.stringify(input);
        if (!attempts.has(key)) attempts.set(key, (async () => {
          const before = await read(channel), proposed = { ...before }, seen = new Set<string>(), quote = norm(str(input.instructionQuote));
          for (const change of input.changes as unknown[]) {
            const item = fields(change, ["field", "value"]), field = str(item.field), value = item.value;
            if (seen.has(field)) return fail("invalid_settings", "Champ répété.", channel); seen.add(field);
            if (field === "defaultMode") {
              const allowed = channel === "threads" ? ["classic", "ghost"] : ["classic", "reel", "story"];
              const names: Record<string, RegExp> = { classic: /\bclassi(?:c|que)\b/, ghost: /\bghost\b/, reel: /\breels?\b/, story: /\bstor(?:y|ies)\b/ };
              if (typeof value !== "string" || !allowed.includes(value) || !names[value].test(quote) || !/\b(?:defaut|definis|definir|mets)\b/.test(quote)) return fail("needs_details", "Indiquez explicitement le format par défaut souhaité.", channel);
            } else {
              if (!(channel === "threads" ? field === "ghostEnabled" : ["reelsEnabled", "storiesEnabled"].includes(field)) || typeof value !== "boolean") return fail("invalid_settings", "Préférence non disponible pour ce canal.", channel);
              const name = field === "ghostEnabled" ? /\bghost\b/ : field === "reelsEnabled" ? /\breels?\b/ : /\bstor(?:y|ies)\b/;
              if (!name.test(quote) || !(value ? /\b(?:active|activer|autorise|autoriser)\b/ : /\b(?:desactive|desactiver|coupe|couper)\b/).test(quote)) return fail("needs_details", "Indiquez les formats à activer ou désactiver.", channel);
            }
            proposed[field] = value;
          }
          const normalized = channel === "facebook" ? parseFacebookPublicationPreferencesPatch(proposed) : channel === "instagram" ? parseInstagramPublicationPreferencesPatch(proposed) : parseThreadsPublicationPreferencesPatch(proposed);
          if (assistantActionFingerprint(before) === assistantActionFingerprint(normalized)) return { ok: true, status: "already_applied", channel, preferences: before, nextAction: link(channel), message: "Le canal contient déjà les préférences de formats demandées. Aucune nouvelle écriture ni publication n’a été effectuée." };
          if (assistantActionFingerprint(before) !== input.expectedVersion) return fail("stale_preview", "Les formats ont changé. Relisez les préférences avant d’enregistrer.", channel);
          if (!await scope()) return fail("blocked", "Le compte actif a changé.", channel);
          const response = await (await api(channel)).PATCH(nativeRequest(request, `/api/integrations/${channel}/publication-preferences`, "PATCH", normalized)), data = row(await response.json());
          if (!response.ok || data.ok !== true) return fail(response.status === 503 ? "unavailable" : "unknown", "Le réglage natif n’a pas confirmé l’enregistrement. Aucune nouvelle tentative automatique n’est effectuée.", channel);
          const saved = await read(channel); if (assistantActionFingerprint(saved) !== assistantActionFingerprint(normalized)) return fail("saved_unconfirmed", "La relecture ne confirme pas les préférences demandées.", channel);
          return { ok: true, status: "saved", channel, preferences: saved, changedFields: [...seen], normalizedDefaultMode: saved.defaultMode, version: assistantActionFingerprint(saved), nextAction: link(channel), message: `Les préférences de formats ont été enregistrées et relues. Le format par défaut enregistré est ${saved.defaultMode === "classic" ? "Classique" : saved.defaultMode === "ghost" ? "Ghost" : saved.defaultMode === "reel" ? "Reel" : "Story"}. Aucune publication n’a été envoyée.` };
        })().catch(() => fail("unknown", "Le résultat n’est pas confirmé. Consultez les formats du canal avant de réessayer.", channel)));
        return attempts.get(key)!;
      } }),
  };
}
