import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { requireUser } from "./requireUser";
import { assistantActionFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
import { isInrAssistantWebsiteConfigurationRequest } from "./inrAssistantBasicTargetIntents.ts";
import { ACTUS_DESIGN_OPTIONS, ACTUS_THEME_OPTIONS, normalizeActusAccent, normalizeActusDesign, normalizeActusLayout, normalizeActusTheme } from "../app/dashboard/dashboard.types";

type Row = Record<string, unknown>;
type Section = "analytics" | "widget";
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const link = { label: "Site Web", href: "/dashboard?panel=site_web" };
const object = (properties: Record<string, JSONSchema7>): JSONSchema7 => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides."); return input; }
function project(site: Row) {
  const ga4 = row(site.ga4), gsc = row(site.gsc), widget = row(site.actus_widget);
  return { url: str(site.url), analytics: { measurementId: str(ga4.measurement_id), propertyId: str(ga4.property_id), searchConsoleProperty: str(gsc.property) }, widget: { layout: normalizeActusLayout(widget.layout), limit: [3, 5, 10].includes(Number(widget.limit)) ? Number(widget.limit) : 5, design: normalizeActusDesign(widget.design), theme: normalizeActusTheme(widget.theme), accent: normalizeActusAccent(widget.accent) } };
}
function authorized(message: string, quote: string, section: Section) {
  return isInrAssistantWebsiteConfigurationRequest(message, section, quote);
}
/** Same account settings/fields as useSiteWebChannel. Never adds an OAuth connection. */
export function createInrAssistantWebsiteTools(options: { request: Request; accountId: string; actorUserId: string; currentUserMessage: string; currentApprovalMessage?: string; canStartWork?: () => boolean; resolvePreview?: (reference: string) => string | null }) {
  const { request, accountId, actorUserId } = options, attempts = new Map<string, Promise<Row>>();
  const fail = (status: string, message: string): Row => ({ ok: false, status, message, nextAction: link });
  const scope = async () => { if (request.signal.aborted || options.canStartWork?.() === false) return null; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId ? auth : null; };
  const read = async () => {
    const auth = await scope(); if (!auth) throw new Error("Compte actif modifié.");
    const result = await auth.supabase.from("pro_tools_configs").select("settings").eq("user_id", accountId).maybeSingle();
    if (result.error) throw result.error;
    const root = row(result.data?.settings), site = row(root.site_web), projected = project(site);
    return { auth, root, site, projected, version: assistantActionFingerprint(projected) };
  };
  const analyticsSnapshot = async (product: "ga4" | "gsc") => {
    const current = await read();
    const integrations = await current.auth.supabase.from("integrations").select("id,status,resource_id,resource_label,provider_account_id,updated_at").eq("user_id", accountId).eq("provider", "google").eq("source", "site_web").eq("product", product);
    if (integrations.error) throw integrations.error;
    return { product, url: current.projected.url, binding: product === "ga4" ? { measurementId: current.projected.analytics.measurementId, propertyId: current.projected.analytics.propertyId } : { property: current.projected.analytics.searchConsoleProperty }, connections: integrations.data ?? [] };
  };
  return {
    readWebsiteConfiguration: tool({ strict: true, description: "Lire la configuration manuelle du canal Site Web : lien enregistré, rattachement GA4 (ID de mesure et propriété), propriété Search Console et apparence du widget Actus. Les identifiants enregistrés ne prouvent pas une connexion Google valide. Ne retourne aucun jeton OAuth ou code widget secret. Renvoie une version avant modification.", inputSchema: jsonSchema<Record<string, never>>(object({})), execute: async raw => {
      fields(raw, []); try { const current = await read(); return { ok: true, status: "read", ...current.projected, version: current.version, allowedFields: { analytics: ["measurementId", "propertyId", "searchConsoleProperty"], widget: ["layout", "limit", "design", "theme", "accent"] }, choices: { layouts: ["list", "carousel", "grid", "compact"], limits: [3, 5, 10], designs: ACTUS_DESIGN_OPTIONS, themes: ACTUS_THEME_OPTIONS }, nextAction: link, untrustedContent: true, message: "La configuration manuelle du Site Web a été lue. Les identifiants enregistrés ne prouvent pas à eux seuls une connexion Google valide." }; } catch { return fail("unavailable", "La configuration du Site Web n’a pas pu être lue."); }
    } }),
    updateWebsiteConfiguration: tool({ strict: true, description: "Enregistrer les champs natifs de rattachement GA4/Search Console ou du widget Actus sur demande explicite. analytics : measurementId G-…, propertyId numérique, searchConsoleProperty sc-domain:… ou URL publique. widget : layout list/carousel/grid/compact, limit 3/5/10, design/thème natifs, accent #RRGGBB. Préserve les champs omis, utilise une écriture conditionnelle et relit les valeurs. Ne connecte pas Google et n’installe pas le widget sur un site externe.",
      inputSchema: jsonSchema<{ section: Section; expectedVersion: string; changes: Array<{ field: string; value: string | number }>; instructionQuote: string }>(object({ section: { type: "string", enum: ["analytics", "widget"] }, expectedVersion: { type: "string", pattern: "^[a-f0-9]{64}$" }, changes: { type: "array", minItems: 1, maxItems: 5, items: object({ field: { type: "string", maxLength: 50 }, value: { type: ["string", "number"], maxLength: 2048 } }) }, instructionQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["section", "expectedVersion", "changes", "instructionQuote"]), section = str(input.section) as Section;
        if (!["analytics", "widget"].includes(section) || !/^[a-f0-9]{64}$/.test(str(input.expectedVersion)) || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 5) return fail("invalid_settings", "Configuration invalide.");
        if (!authorized(options.currentUserMessage, str(input.instructionQuote), section)) return fail("needs_instruction", "Indiquez explicitement la configuration du Site Web à enregistrer.");
        const key = JSON.stringify(input);
        if (!attempts.has(key)) attempts.set(key, (async () => {
          const before = await read(), next = structuredClone(before.projected), requested = row(next[section]), seen = new Set<string>();
          if (!before.projected.url) return fail("needs_details", "Enregistrez d’abord le lien du Site Web dans son canal.");
          for (const change of input.changes as unknown[]) {
            const item = fields(change, ["field", "value"]), field = str(item.field), value = item.value;
            if (seen.has(field)) return fail("invalid_settings", "Champ répété."); seen.add(field);
            if (section === "analytics") {
              if (typeof value !== "string" || !["measurementId", "propertyId", "searchConsoleProperty"].includes(field) || !value.trim() || value.length > 2048 || /[\u0000-\u001f]/.test(value)) return fail("invalid_settings", "Rattachement Google invalide.");
              const clean = value.trim();
              if (field === "measurementId" && !/^G-[A-Z0-9]{4,30}$/i.test(clean) || field === "propertyId" && !/^\d{1,30}$/.test(clean)) return fail("invalid_settings", "Renseignez l’ID de mesure GA4 et l’identifiant numérique exact de propriété.");
              if (field === "searchConsoleProperty") {
                try { const propertyUrl = new URL(clean.startsWith("sc-domain:") ? `https://${clean.slice(10)}` : clean); if (!["http:", "https:"].includes(propertyUrl.protocol) || propertyUrl.username || propertyUrl.password || !propertyUrl.hostname.includes(".") || propertyUrl.search || propertyUrl.hash || clean.startsWith("sc-domain:") && propertyUrl.pathname !== "/") throw new Error(); } catch { return fail("invalid_settings", "La propriété Search Console doit être un domaine sc-domain:… ou une URL publique valide."); }
              }
              // Exact IDs/properties must come from the user's own instruction.
              if (!str(input.instructionQuote).includes(clean)) return fail("needs_details", "Indiquez les identifiants Google exacts à rattacher.");
              requested[field] = field === "measurementId" ? clean.toUpperCase() : clean;
            } else {
              if (field === "layout" && typeof value === "string" && ["list", "carousel", "grid", "compact"].includes(value)) requested.layout = normalizeActusLayout(value);
              else if (field === "limit" && typeof value === "number" && [3, 5, 10].includes(value)) requested.limit = value;
              else if (field === "design" && ACTUS_DESIGN_OPTIONS.some(option => option.value === value)) requested.design = normalizeActusDesign(value);
              else if (field === "theme" && ACTUS_THEME_OPTIONS.some(option => option.value === value)) requested.theme = normalizeActusTheme(value);
              else if (field === "accent" && typeof value === "string" && (value === "" || /^#[a-f0-9]{6}$/i.test(value))) requested.accent = normalizeActusAccent(value);
              else return fail("invalid_settings", "Réglage du widget inconnu ou invalide.");
            }
          }
          if (section === "analytics" && Boolean(requested.measurementId) !== Boolean(requested.propertyId)) return fail("needs_details", "Fournissez ensemble l’ID de mesure et l’identifiant de propriété GA4.");
          if (section === "widget" && requested.theme === "custom" && !requested.accent) return fail("needs_details", "Le thème personnalisé nécessite une couleur #RRGGBB.");
          if (assistantActionFingerprint(next) === before.version) return { ok: true, status: "already_applied", ...next, version: before.version, nextAction: link, message: "Le Site Web contient déjà les réglages demandés. Aucune nouvelle écriture n’a été effectuée." };
          if (before.version !== input.expectedVersion) return fail("stale_preview", "La configuration a changé. Relisez le Site Web avant d’enregistrer.");
          const site = { ...before.site };
          if (section === "analytics") { if (requested.measurementId && requested.propertyId) site.ga4 = { ...row(site.ga4), measurement_id: requested.measurementId, property_id: requested.propertyId }; if (requested.searchConsoleProperty) site.gsc = { ...row(site.gsc), property: requested.searchConsoleProperty }; }
          else site.actus_widget = { ...row(site.actus_widget), ...requested, generated_at: new Date().toISOString() };
          const auth = await scope(); if (!auth) return fail("blocked", "Le compte actif a changé.");
          const saved = await auth.supabase.from("pro_tools_configs").update({ settings: { ...before.root, site_web: site } }).eq("user_id", accountId).eq("settings", JSON.stringify(before.root)).select("user_id").maybeSingle();
          if (saved.error || saved.data?.user_id !== accountId) return fail("stale_preview", "La configuration a changé pendant l’enregistrement. Relisez-la avant de réessayer.");
          const after = await read();
          if (assistantActionFingerprint(after.projected) !== assistantActionFingerprint(next)) return fail("saved_unconfirmed", "La relecture du Site Web ne confirme pas les réglages demandés.");
          const response = await (await import("@/app/api/integrations/site-presence/sync/route")).POST();
          return { ok: true, status: "saved", ...after.projected, version: after.version, changedFields: [...seen], presenceSyncPending: !response.ok, nextAction: link, message: section === "analytics" ? "Rattachement manuel enregistré et vérifié. La connexion Google et l’accès aux statistiques doivent être confirmés par le canal." : "Apparence du widget enregistrée et vérifiée. Le code d’installation reste disponible dans le canal Site Web.", untrustedContent: true };
        })().catch(() => fail("unknown", "Le résultat de la configuration n’est pas confirmé. Consultez le Site Web avant de réessayer.")));
        return attempts.get(key)!;
      } }),
    previewWebsiteAnalyticsDisconnection: tool({ strict: true, description: "Préparer la déconnexion explicite de Google Analytics/GA4 ou Search Console/GSC du Site Web. Présente l’impact puis attend la validation référencée. Le lien du site et l’autre produit restent conservés ; les statistiques nécessitant ce produit ne seront plus accessibles avant reconnexion.",
      inputSchema: jsonSchema<{ product: "ga4" | "gsc"; instructionQuote: string }>(object({ product: { type: "string", enum: ["ga4", "gsc"] }, instructionQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["product", "instructionQuote"]), product = str(input.product) as "ga4" | "gsc", quote = str(input.instructionQuote), current = inrAssistantMaskQuotedText(options.currentUserMessage), text = current.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(), instruction = quote.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
        if (!["ga4", "gsc"].includes(product)) return fail("invalid_settings", "Produit Google invalide.");
        if (!quote || quote.length > 1200 || !current.includes(quote) || !/\b(?:deconnecte|deconnecter|dissocie|dissocier|retire|retirer)\b/.test(instruction) || !(product === "ga4" ? /\b(?:analytics|ga4)\b/ : /\b(?:search console|gsc)\b/).test(instruction) || /\b(?:comment|pourquoi|explique|si|quand|lorsque|demain|plus tard|ne pas)\b|\bne\b.{0,60}\bpas\b|\b(?:deconnecte|dissocie|retire)\s+pas\b|\b(?:dans)\s+(?:\d+|un|une|deux|trois)\s*(?:minute|heure|jour)\b/.test(text)) return fail("needs_instruction", "Précisez le produit Google à déconnecter du Site Web.");
        try {
          const snapshot = await analyticsSnapshot(product), preview = createAssistantActionPreview({ accountId, actorUserId, kind: "website_analytics_disconnection", targetId: product, fingerprint: assistantActionFingerprint(snapshot), patch: {} });
          return { ok: true, status: "preview_ready", approvalKind: "website_analytics_disconnection", product, binding: snapshot.binding, ...preview, message: `La déconnexion Google du Site Web est préparée et attend votre validation. Vérifiez le produit et l’impact, puis dites « Confirme ${preview.reference} ». Aucune déconnexion n’a encore été effectuée.`, impact: `La connexion ${product === "ga4" ? "Google Analytics" : "Search Console"} du Site Web et son rattachement seront retirés. Les statistiques de ce produit attendront une nouvelle connexion.`, nextAction: link };
        } catch { return fail("unavailable", "La déconnexion Google n’a pas pu être préparée."); }
      } }),
    applyWebsiteAnalyticsDisconnection: tool({ strict: true, description: "Appliquer la déconnexion GA4/GSC prévisualisée, après validation actuelle de sa référence IA-. Recontrôle le compte et la connexion inchangée, utilise le bouton natif Google Stats puis relit connexion et rattachement. Aucune relance automatique sur résultat incertain.",
      inputSchema: jsonSchema<{ reference: string; approvalQuote: string }>(object({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, approvalQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["reference", "approvalQuote"]), reference = str(input.reference);
        if (!hasAssistantActionApproval(options.currentApprovalMessage ?? options.currentUserMessage, str(input.approvalQuote), reference)) return fail("needs_confirmation", "Validez explicitement la référence de déconnexion présentée.");
        const token = options.resolvePreview?.(reference), preview = token && verifyAssistantActionPreview(token, { accountId, actorUserId, kind: "website_analytics_disconnection" });
        if (!preview || preview.reference !== reference || !["ga4", "gsc"].includes(preview.targetId)) return fail("stale_preview", "La préparation a expiré ou ne correspond pas au compte actif.");
        if (!attempts.has(reference)) attempts.set(reference, (async () => {
          const product = preview.targetId as "ga4" | "gsc", snapshot = await analyticsSnapshot(product);
          if (assistantActionFingerprint(snapshot) !== preview.fingerprint) return fail("stale_preview", "La connexion Google a changé. Préparez à nouveau la déconnexion.");
          if (!await scope()) return fail("blocked", "Le compte actif a changé.");
          const headers = new Headers({ "content-type": "application/json" }); for (const name of ["cookie", "authorization"]) { const value = request.headers.get(name); if (value) headers.set(name, value); }
          const response = await (await import("@/app/api/integrations/google-stats/disconnect/route")).POST(new Request(new URL("/api/integrations/google-stats/disconnect", request.url), { method: "POST", headers, signal: request.signal, body: JSON.stringify({ source: "site_web", product }) })), data = row(await response.json());
          if (!response.ok || data.ok !== true) return fail("unknown", "La déconnexion n’est pas confirmée. Vérifiez le canal Site Web avant de réessayer.");
          const after = await analyticsSnapshot(product);
          if (Object.values(after.binding).some(Boolean) || after.connections.some((connection: unknown) => row(connection).status !== "disconnected")) return fail("saved_unconfirmed", "La relecture ne confirme pas la déconnexion complète du produit Google.");
          return { ok: true, status: "saved", product, connected: false, nextAction: link, message: "La déconnexion et le retrait du rattachement sont vérifiés." };
        })().catch(() => fail("unknown", "Le résultat de la déconnexion n’est pas confirmé. Consultez le Site Web avant de réessayer.")));
        return attempts.get(reference)!;
      } }),
  };
}
