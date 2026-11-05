import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { requireUser } from "./requireUser";
import { assistantActionFingerprint } from "./inrAssistantActionPreview.ts";
import { isInrAssistantNativePresentationRequest } from "./inrAssistantBasicTargetIntents.ts";
import { DEFAULT_INR_SEARCH_DISPLAY_SETTINGS, DEFAULT_INR_SEARCH_SECTIONS } from "./inrSearchDisplaySettings";
import { normalizeInrBadgeThemeSettings, INRBADGE_THEME_PRESETS } from "./inrBadgeTheme";

type Row = Record<string, unknown>;
type Channel = "inrbadge" | "inr_search";
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const object = (properties: Record<string, JSONSchema7>): JSONSchema7 => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const link = (channel: Channel) => ({ label: channel === "inrbadge" ? "iNr’Badge" : "iNr’Search", href: `/dashboard?panel=${channel}` });
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides."); return input; }
function local(source: Request, path: string, method: string, body: unknown) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of ["cookie", "authorization"]) { const value = source.headers.get(name); if (value) headers.set(name, value); }
  return new Request(new URL(path, source.url), { headers, method, signal: source.signal, body: JSON.stringify(body) });
}
function explicitInstruction(message: string, quote: string, channel: Channel) {
  return isInrAssistantNativePresentationRequest(message, channel, quote);
}
export function createInrAssistantNativePresentationTools(options: { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; currentUserMessage: string; canStartWork?: () => boolean }) {
  const { request, accountId, actorUserId } = options;
  const attempts = new Map<string, Promise<Row>>();
  const fail = (status: string, message: string, channel: Channel): Row => ({ ok: false, status, message, nextAction: link(channel) });
  const scope = async () => {
    if (request.signal.aborted || options.canStartWork?.() === false) return false;
    const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId;
  };
  const read = async (channel: Channel) => {
    if (!await scope()) throw new Error("Compte actif modifié.");
    const response = channel === "inrbadge" ? await (await import("@/app/api/inrbadge/settings/route")).GET() : await (await import("@/app/api/inr-search/settings/route")).GET();
    const data = row(await response.json());
    if (!response.ok || data.ok !== true || channel === "inr_search" && data.accountId !== accountId) throw new Error("Réglages indisponibles.");
    if (channel === "inrbadge") return { theme: normalizeInrBadgeThemeSettings(data.theme) };
    const search = row(data.inrSearch);
    return { display: row(search.display), sections: row(search.sections), pageTitleOverride: str(search.pageTitleOverride), pageDescriptionOverride: str(search.pageDescriptionOverride) };
  };
  const nativeUpdate = async (channel: Channel, patch: Row) => channel === "inrbadge"
    ? (await import("@/app/api/inrbadge/settings/route")).PATCH(local(request, "/api/inrbadge/settings", "PATCH", patch))
    : (await import("@/app/api/inr-search/settings/route")).POST(local(request, "/api/inr-search/settings", "POST", { action: "presentation", accountId, ...patch }));
  return {
    readNativeChannelPresentation: tool({ strict: true, description: "Lire la présentation native d’iNr’Badge (thème et palette) ou iNr’Search (visibilités publiques, sections et titre/description propres à la page). Retourne une version à réutiliser avant modification et les champs permis en Basique. Les coordonnées privées, l’ADN et les rendez-vous ne sont pas modifiés.",
      inputSchema: jsonSchema<{ channel: Channel }>(object({ channel: { type: "string", enum: ["inrbadge", "inr_search"] } })), execute: async raw => {
        const input = fields(raw, ["channel"]), channel = str(input.channel) as Channel;
        if (!["inrbadge", "inr_search"].includes(channel)) return { ok: false, status: "invalid_settings", message: "Canal invalide." };
        try {
          const current = await read(channel);
          const allowedFields = channel === "inrbadge" ? ["theme.id", "theme.primary", "theme.secondary", "theme.accent"] : [...Object.keys(DEFAULT_INR_SEARCH_DISPLAY_SETTINGS).map(key => `display.${key}`), ...Object.keys(DEFAULT_INR_SEARCH_SECTIONS).map(key => `sections.${key}`), "pageTitleOverride", "pageDescriptionOverride"];
          return { ok: true, status: "read", channel, current, version: assistantActionFingerprint(current), allowedFields, ...(channel === "inrbadge" ? { themes: [...INRBADGE_THEME_PRESETS.map(theme => ({ id: theme.id, label: theme.label })), { id: "identity", label: "Couleurs de l’identité" }] } : {}), nextAction: link(channel), untrustedContent: true, message: "Les réglages de présentation du canal ont été lus. Aucun réglage n’a été modifié." };
        } catch { return fail("unavailable", "Les réglages du canal ne sont pas disponibles.", channel); }
      } }),
    updateNativeChannelPresentation: tool({ strict: true, description: "Enregistrer sur ordre explicite la présentation iNr’Badge ou iNr’Search déjà lue. Badge : theme.id et couleurs #RRGGBB. Search : display.champ/sections.champ booléens, pageTitleOverride (160), pageDescriptionOverride (500), chaîne vide pour rétablir le texte généré. Préserve les autres champs et utilise les mêmes routes que l’interface. Relit chaque valeur avant d’annoncer un succès.",
      inputSchema: jsonSchema<{ channel: Channel; expectedVersion: string; changes: Array<{ field: string; value: string | boolean }>; instructionQuote: string }>(object({ channel: { type: "string", enum: ["inrbadge", "inr_search"] }, expectedVersion: { type: "string", pattern: "^[a-f0-9]{64}$" }, changes: { type: "array", minItems: 1, maxItems: 24, items: object({ field: { type: "string", maxLength: 80 }, value: { type: ["string", "boolean"], maxLength: 500 } }) }, instructionQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["channel", "expectedVersion", "changes", "instructionQuote"]), channel = str(input.channel) as Channel;
        if (!["inrbadge", "inr_search"].includes(channel) || !/^[a-f0-9]{64}$/.test(str(input.expectedVersion)) || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 24) return { ok: false, status: "invalid_settings", message: "Réglages invalides." };
        if (!explicitInstruction(options.currentUserMessage, str(input.instructionQuote), channel)) return fail("needs_instruction", "Précisez le canal et les modifications à enregistrer dans votre demande actuelle.", channel);
        const key = JSON.stringify(input);
        if (!attempts.has(key)) attempts.set(key, (async () => {
          const current = await read(channel), patch: Row = {}, expected: Row = structuredClone(current), seen = new Set<string>();
          for (const change of input.changes as unknown[]) {
            const item = fields(change, ["field", "value"]), field = str(item.field), value = item.value;
            if (seen.has(field)) return fail("invalid_settings", "Un champ est présent plusieurs fois.", channel);
            seen.add(field);
            if (channel === "inrbadge") {
              const theme = row(expected.theme);
              if (field === "theme.id") { if (typeof value !== "string" || ![...INRBADGE_THEME_PRESETS.map(theme => theme.id), "identity"].includes(value as never)) return fail("invalid_settings", "Thème Badge invalide.", channel); theme.id = value; }
              else if (["theme.primary", "theme.secondary", "theme.accent"].includes(field) && typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) theme.identityColors = { ...row(theme.identityColors), [field.slice(6)]: value.toUpperCase() };
              else return fail("invalid_settings", "Couleur Badge invalide ou champ non disponible.", channel);
              expected.theme = theme;
            } else if (field.startsWith("display.") || field.startsWith("sections.")) {
              const [group, name, extra] = field.split("."), defaults = group === "display" ? DEFAULT_INR_SEARCH_DISPLAY_SETTINGS : DEFAULT_INR_SEARCH_SECTIONS;
              if (extra || !Object.hasOwn(defaults, name) || typeof value !== "boolean") return fail("invalid_settings", "Choix d’affichage Search invalide.", channel);
              patch[group] = { ...row(patch[group]), [name]: value }; expected[group] = { ...row(expected[group]), [name]: value };
            } else if (["pageTitleOverride", "pageDescriptionOverride"].includes(field) && typeof value === "string" && value.length <= (field === "pageTitleOverride" ? 160 : 500) && !/[\u0000-\u001f]/.test(value)) { patch[field] = value.trim(); expected[field] = value.trim(); }
            else return fail("invalid_settings", "Champ de présentation non disponible.", channel);
          }
          if (channel === "inrbadge") {
            const requested = row(expected.theme), normalized = normalizeInrBadgeThemeSettings(requested);
            if (requested.id === "identity" && !normalized.identityColors) return fail("invalid_settings", "Indiquez au moins la couleur principale #RRGGBB pour le thème d’identité.", channel);
            patch.theme = normalized; expected.theme = normalized;
          }
          if (assistantActionFingerprint(current) === assistantActionFingerprint(expected)) return { ok: true, status: "already_applied", channel, current, version: assistantActionFingerprint(current), nextAction: link(channel), message: "La présentation contient déjà les réglages demandés. Aucune nouvelle écriture n’a été effectuée." };
          if (assistantActionFingerprint(current) !== input.expectedVersion) return fail("stale_preview", "La présentation a changé. Relisez les réglages avant de préparer à nouveau la modification.", channel);
          if (!await scope()) return fail("blocked", "Le compte actif a changé.", channel);
          const response = await nativeUpdate(channel, patch), data = row(await response.json());
          if (!response.ok || data.ok !== true) return fail("unknown", "L’enregistrement n’est pas confirmé. Vérifiez les réglages du canal.", channel);
          const saved = await read(channel);
          if (assistantActionFingerprint(saved) !== assistantActionFingerprint(expected)) return fail("saved_unconfirmed", "Le canal a répondu mais la relecture ne confirme pas les réglages demandés.", channel);
          return { ok: true, status: "saved", channel, current: saved, changedFields: [...seen], version: assistantActionFingerprint(saved), nextAction: link(channel), untrustedContent: true, message: "Les réglages de présentation demandés ont été enregistrés et leur relecture confirme les valeurs." };
        })().catch(() => fail("unknown", "Le résultat n’est pas confirmé. Consultez le canal avant de réessayer.", channel)));
        return attempts.get(key)!;
      } }),
  };
}
