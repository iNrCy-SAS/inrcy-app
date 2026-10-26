import "server-only";
import { jsonSchema, tool } from "ai";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";

type Row = Record<string, unknown>;
type Value = string | number | boolean | number[];
const TOOLS = ["calendar", "notifications", "documents", "badge", "studio", "tiktok"] as const;
type Tool = typeof TOOLS[number];
const LINKS: Record<Tool, { label: string; href: string }> = {
  calendar: { label: "Réglages iNr’Calendar", href: "/dashboard?panel=agenda" },
  notifications: { label: "Notifications", href: "/dashboard?panel=notifications" },
  documents: { label: "Réglages des documents", href: "/dashboard?panel=documents" },
  badge: { label: "iNr’Badge", href: "/dashboard?panel=inrbadge" },
  studio: { label: "iNr’Studio", href: "/dashboard/generer-media" },
  tiktok: { label: "TikTok", href: "/dashboard?panel=tiktok" },
};
const FIELDS: Record<Tool, string[]> = {
  calendar: ["selectedMailAccountId", "sendConfirmationOnSave", "reminderOffsetsMinutes"],
  notifications: ["in_app_enabled", "email_enabled", "performance_enabled", "action_enabled", "information_enabled", "digest_every_hours"],
  documents: ["common.operationCategory", "common.depositKind", "common.depositValue", "common.paymentMethod", "common.paymentDetails", "common.notes", "common.design.preset", "common.design.accentColor", "common.design.frame", "common.design.coloredTotals", "common.design.coloredParties", "quote.validityDays", "quote.mention", "invoice.dueDays", "invoice.lateFeeRate", "invoice.fixedRecoveryFee40", "invoice.vatOnDebits", "invoice.mention"],
  badge: ["logo", "name", "company", "phone", "email", "saveContact", "inrSearch", "siteWeb", "googleBusiness", "facebook", "instagram", "linkedin", "x", "pinterest", "mails", "tiktok", "youtubeShorts", "appointment", "quote"],
  studio: ["1.kind", "1.subjectSource", "2.typology", "2.format", "3.visualStyle", "3.creativity", "3.imagePurpose", "3.visualDirection", "3.sceneMode", "3.useBrandColors", "3.logoMode", "4.imageStyle", "4.shotType", "5.peopleMode", "5.sourceMode", "5.aiPeopleCriterion", "5.aiSettingCriterion", "5.aiFocusCriterion", "5.identityMode", "5.teamVideoMode", "5.teamVideoSpeechMode", "6.durationSeconds", "6.connectScenes", "6.withText", "6.withMusic", "6.withNarration", "6.narrationVoice", "6.narrationVoiceVariant"],
  tiktok: ["defaults.preferredMedia", "defaults.allowComments", "defaults.allowDuo", "defaults.allowStitch", "defaults.photoAutoMusic", "defaults.commercialContent", "defaults.aiContent"],
};
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const at = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((parent, key) => row(parent)[key], value);
function put(target: Row, path: string, value: unknown) {
  const keys = path.split("."); let parent = target;
  for (const key of keys.slice(0, -1)) { parent[key] ??= {}; parent = row(parent[key]); }
  parent[keys.at(-1)!] = value;
}
function parseTool(value: unknown): Tool {
  if (typeof value !== "string" || !TOOLS.includes(value as Tool)) throw new Error("Outil inconnu.");
  return value as Tool;
}
function strict(input: unknown, keys: string[]) {
  const data = row(input);
  if (Object.keys(data).length !== keys.length || Object.keys(data).some(key => !keys.includes(key))) throw new Error("Réglages invalides.");
  return data;
}
function authorized(message: string, quote: string, target: Tool) {
  if (!quote || !message.includes(quote)) return false;
  const text = normalize(message.replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm, " ")).trim();
  if (/^(?:comment|pourquoi|explique|how|why|what)\b|\b(?:comment|how).{0,40}(?:modifi|chang|regl|configur)/.test(text) || /\b(?:ne |n['’]|sans |do not |don't ).{0,35}(?:modif|chang|regl|configur|activ|enregistr)/.test(text)) return false;
  if (/^(?:est.ce que (?:je|on|nous)\b|(?:je|on|nous) (?:peux|peut|pouvons|pourrais|pourrait|pourrions)\b|est.il possible\b|(?:si|imagine|suppose|souviens.toi|rappelle.toi)\b)/.test(text)) return false;
  const subjects: Record<Tool, RegExp> = { calendar: /agenda|calendar|rendez.vous|\brdv\b/, notifications: /notif|preferences|alertes?/, documents: /devis|factures?|documents?|encaisser/, badge: /badge|qr.code/, studio: /studio|generateur|generation|images?|videos?/, tiktok: /tiktok/ };
  return subjects[target].test(text) && /\b(?:modifi\w*|chang\w*|regl\w*|configur\w*|mets|mettez|active\w*|desactive\w*|enregistr\w*|remplac\w*|defini\w*|update|set|disable|enable)\b/.test(text);
}
function nativeRequest(source: Request, target: Tool, body?: unknown) {
  const paths: Record<Tool, string> = { calendar: "/api/calendar/settings", notifications: "/api/notifications/preferences", documents: "/api/documents/settings", badge: "/api/inrbadge/settings", studio: "/api/media-generation/preferences", tiktok: "/api/integrations/tiktok/settings" };
  const methods: Record<Tool, string> = { calendar: "PATCH", notifications: "PUT", documents: "PATCH", badge: "PATCH", studio: "PATCH", tiktok: "POST" };
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  for (const name of ["cookie", "authorization"]) { const value = source.headers.get(name); if (value) headers.set(name, value); }
  return new Request(new URL(paths[target], source.url), { method: body === undefined ? "GET" : methods[target], headers, signal: source.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function route(target: Tool) {
  switch (target) {
    case "calendar": return import("@/app/api/calendar/settings/route");
    case "notifications": return import("@/app/api/notifications/preferences/route");
    case "documents": return import("@/app/api/documents/settings/route");
    case "badge": return import("@/app/api/inrbadge/settings/route");
    case "studio": return import("@/app/api/media-generation/preferences/route");
    case "tiktok": return import("@/app/api/integrations/tiktok/settings/route");
  }
}
function publicSettings(target: Tool, data: Row) {
  const source = target === "notifications" || target === "studio" ? row(data.preferences) : target === "documents" || target === "badge" ? row(data.settings) : target === "tiktok" ? row(data.tiktok) : data;
  const output: Row = {};
  for (const field of FIELDS[target]) {
    const parts = field.split(".");
    const value = target === "studio" ? at(row(row(source.blocks)[parts[0]]).defaults, parts[1]) : at(source, field);
    if (["boolean", "number"].includes(typeof value) || typeof value === "string" && value.length <= 1200 || Array.isArray(value) && value.length <= 8 && value.every(item => typeof item === "number")) output[field] = value;
  }
  return output;
}

/** Fixed native settings adapters; no arbitrary route, table, environment or account argument. */
export function createInrAssistantSettingsTools(options: { request: Request; accountId: string; edition: DashboardEdition; currentUserMessage: string; canStartWork?: () => boolean }) {
  const { request, accountId, edition } = options;
  const pending = new Map<string, Promise<Row>>();
  const scope = async (target: Tool) => {
    if (request.signal.aborted || options.canStartWork?.() === false || target === "documents" && edition !== "founder" || target === "calendar" && edition === "standard") return false;
    const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId;
  };
  const fail = (target: Tool, status = "unavailable"): Row => ({ ok: false, status, nextAction: LINKS[target], message: status === "needs_instruction" ? "Précisez le réglage à modifier dans votre demande actuelle. Aucun réglage n’a changé." : "Le réglage ne peut pas être confirmé. Vérifiez le module ; aucune modification supplémentaire n’est annoncée." });
  const read = async (target: Tool) => {
    if (!await scope(target)) return null;
    const api = await route(target);
    const response = await (api.GET as (request: Request) => Promise<Response>)(nativeRequest(request, target));
    if (!response.ok) return null;
    const data = row(await response.json());
    return { data, settings: publicSettings(target, data) };
  };
  return {
    readToolSettings: tool({ strict: true, description: "Lire les réglages ACTUELS autorisés d’iNr’Calendar, Notifications, Documents (Founder), iNr’Badge, iNr’Studio ou TikTok. Champs publics seulement, sans clés ni comptes externes. Utiliser les champs retournés pour une correction précise. Une lecture ne change aucun réglage.",
      inputSchema: jsonSchema<{ tool: Tool }>({ type: "object", properties: { tool: { type: "string", enum: [...TOOLS] } }, required: ["tool"], additionalProperties: false }),
      execute: async raw => {
        const target = parseTool(strict(raw, ["tool"]).tool);
        try { const current = await read(target); return current ? { ok: true, status: "read", tool: target, settings: current.settings, editableFields: FIELDS[target], nextAction: LINKS[target] } : fail(target); } catch { return fail(target); }
      },
    }),
    updateToolSettings: tool({ strict: true, description: "Corriger des réglages précis sur ordre ACTUEL, après readToolSettings. tool=calendar|notifications|documents|badge|studio|tiktok ; changes utilise les noms EXACTS retournés. Valeurs scalaires ou liste numérique. Préserve les champs omis, vérifie les valeurs réellement enregistrées. Studio : un seul bloc par action. Pas de changement de déclaration légale TikTok, d’identité/secret, d’abonnement ou d’activation d’un agent. Pas de génération, envoi ou rendez-vous créé.",
      inputSchema: jsonSchema<{ tool: Tool; instructionQuote: string; changes: { field: string; value: Value }[] }>({ type: "object", properties: {
        tool: { type: "string", enum: [...TOOLS] }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 }, changes: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", properties: { field: { type: "string", maxLength: 80 }, value: { anyOf: [{ type: "string", maxLength: 1200 }, { type: "boolean" }, { type: "number" }, { type: "array", maxItems: 8, items: { type: "integer", minimum: 0, maximum: 2880 } }] } }, required: ["field", "value"], additionalProperties: false } },
      }, required: ["tool", "instructionQuote", "changes"], additionalProperties: false }),
      execute: async raw => {
        const input = strict(raw, ["tool", "instructionQuote", "changes"]); const target = parseTool(input.tool);
        if (typeof input.instructionQuote !== "string" || input.instructionQuote.length > 1200 || !authorized(options.currentUserMessage, input.instructionQuote, target)) return fail(target, "needs_instruction");
        if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 10) return fail(target, "invalid_settings");
        const key = JSON.stringify(input); if (pending.has(key)) return pending.get(key)!;
        const work = (async (): Promise<Row> => {
          const current = await read(target); if (!current) return fail(target);
          const patch: Row = {}; const desired: Row = {}; let block: string | undefined;
          for (const rawChange of input.changes as unknown[]) {
            const change = strict(rawChange, ["field", "value"]); const field = typeof change.field === "string" ? change.field : ""; const value = change.value;
            if (!FIELDS[target].includes(field) || Object.hasOwn(desired, field) || value === null || !["string", "boolean", "number"].includes(typeof value) && !(Array.isArray(value) && value.length <= 8 && value.every(item => Number.isInteger(item) && item >= 0 && item <= 2880))) return fail(target, "invalid_settings");
            if (typeof value === "string" && (value.length > 1200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) || typeof value === "number" && !Number.isFinite(value)) return fail(target, "invalid_settings");
            const before = current.settings[field];
            if (before !== undefined && (Array.isArray(before) ? !Array.isArray(value) : typeof before !== typeof value)) return fail(target, "invalid_settings");
            // Regulatory labels describe the real post; never persist a guessed default declaration.
            if (target === "tiktok" && ["defaults.aiContent", "defaults.commercialContent"].includes(field)) return fail(target, "confirmation_required");
            if (target === "badge" && field === "appointment" && edition === "standard") return fail(target, "not_included");
            desired[field] = value;
            if (target === "studio") { const [id, name] = field.split("."); if (block && block !== id) return fail(target, "invalid_settings"); block = id; patch[name] = value; }
            else put(patch, field, value);
          }
          let body: unknown = patch;
          if (target === "notifications") body = { ...current.settings, ...patch };
          if (target === "badge") body = { settings: { ...row(current.data.settings), ...patch } };
          if (target === "documents") body = { settings: patch };
          if (target === "studio") body = { blockId: Number(block), saved: true, defaults: { ...row(row(row(row(current.data.preferences).blocks)[block!]).defaults), ...patch } };
          if (!await scope(target)) return fail(target, "blocked");
          const api = await route(target);
          const method = target === "notifications" ? "PUT" : target === "tiktok" ? "POST" : "PATCH";
          const handler = (api as unknown as Record<string, (request: Request) => Promise<Response>>)[method];
          const response = await handler(nativeRequest(request, target, body));
          if (!response.ok) return fail(target);
          const saved = await read(target); if (!saved) return fail(target, "saved_unconfirmed");
          const changedFields = Object.keys(desired).filter(field => JSON.stringify(saved.settings[field]) === JSON.stringify(desired[field]));
          return { ok: changedFields.length === Object.keys(desired).length, status: changedFields.length === Object.keys(desired).length ? "saved" : "partial", changedFields, settings: saved.settings, nextAction: LINKS[target], message: changedFields.length === Object.keys(desired).length ? "Les réglages demandés ont été enregistrés et relus dans l’outil." : "Certains réglages ont été ajustés ou refusés par l’outil. Vérifiez les valeurs enregistrées avant de poursuivre." };
        })().catch(() => fail(target));
        pending.set(key, work); return work;
      },
    }),
  };
}
