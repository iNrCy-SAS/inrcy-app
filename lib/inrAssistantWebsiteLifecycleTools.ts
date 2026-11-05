import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import { requireUser } from "./requireUser";
import { assistantActionFingerprint, createAssistantActionPreview, hasAssistantActionApproval, verifyAssistantActionPreview } from "./inrAssistantActionPreview.ts";
import { isInrAssistantWebsiteLifecycleRequest } from "./inrAssistantBasicTargetIntents.ts";
type Row = Record<string, unknown>;
type Mode = "remove_url" | "reset";
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const schema = (properties: Record<string, JSONSchema7>): JSONSchema7 => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const link = { label: "Site Web", href: "/dashboard?panel=site_web" };
const withoutGoogle = (site: Row) => Object.fromEntries(Object.entries(site).filter(([key]) => !["ga4", "gsc"].includes(key)));
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides."); return input; }
function nativeRequest(source: Request, path: string, body: unknown) { const headers = new Headers({ "content-type": "application/json" }); for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); } return new Request(new URL(path, source.url), { headers, method: "POST", signal: source.signal, body: JSON.stringify(body) }); }
/** Mirrors the native delete URL/reset choreography, preserving partial outcomes. */
export function createInrAssistantWebsiteLifecycleTools(options: { request: Request; accountId: string; actorUserId: string; currentUserMessage: string; currentApprovalMessage?: string; canStartWork?: () => boolean; resolvePreview?: (reference: string) => string | null }) {
  const { request, accountId, actorUserId } = options, attempts = new Map<string, Promise<Row>>();
  const fail = (status: string, message: string, extra: Row = {}): Row => ({ ok: false, status, message, nextAction: link, ...extra });
  const scope = async () => { if (request.signal.aborted || options.canStartWork?.() === false) return null; const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === accountId && auth.authUserId === actorUserId ? auth : null; };
  const read = async () => {
    const auth = await scope(); if (!auth) throw new Error("Compte actif modifié.");
    const [config, integrations] = await Promise.all([
      auth.supabase.from("pro_tools_configs").select("settings").eq("user_id", accountId).maybeSingle(),
      auth.supabase.from("integrations").select("id,product,status,resource_id,provider_account_id,updated_at").eq("user_id", accountId).eq("provider", "google").eq("source", "site_web").in("product", ["ga4", "gsc"]),
    ]);
    if (config.error || integrations.error) throw new Error("Configuration indisponible.");
    const root = row(config.data?.settings), site = row(root.site_web);
    return { auth, root, site, integrations: integrations.data ?? [], fingerprint: assistantActionFingerprint({ site, integrations: integrations.data ?? [] }) };
  };
  return {
    previewWebsiteReset: tool({ strict: true, description: "Préparer les boutons natifs Site Web : mode remove_url supprime le lien et déconnecte GA4/GSC ; mode reset réinitialise en plus toute la configuration du canal, widget inclus. Ne supprime pas le site externe. Présente le lien et l’impact avant validation référencée. Autres canaux conservés.",
      inputSchema: jsonSchema<{ mode: Mode; instructionQuote: string }>(schema({ mode: { type: "string", enum: ["remove_url", "reset"] }, instructionQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["mode", "instructionQuote"]), mode = str(input.mode) as Mode, quote = str(input.instructionQuote);
        if (!["remove_url", "reset"].includes(mode)) return fail("invalid_settings", "Action Site Web invalide.");
        if (!isInrAssistantWebsiteLifecycleRequest(options.currentUserMessage, mode, quote)) return fail("needs_instruction", "Précisez la suppression du lien Site Web ou la réinitialisation complète du canal. Supprimer une photo ou un article ne réinitialise pas le canal.");
        try {
          const current = await read(), preview = createAssistantActionPreview({ accountId, actorUserId, kind: "website_reset", targetId: "site_web", fingerprint: current.fingerprint, patch: { mode } });
          return { ok: true, status: "preview_ready", approvalKind: "website_reset", mode, url: str(current.site.url), ...preview, message: `L’action Site Web est préparée et attend votre validation. Vérifiez le lien, le périmètre et l’impact, puis dites « Confirme ${preview.reference} ». Aucune suppression ni réinitialisation n’a encore été effectuée.`, impact: mode === "reset" ? "Le lien, les rattachements et connexions GA4/GSC ainsi que la configuration du widget Site Web seront retirés. Le site externe et les autres canaux restent conservés." : "Le lien et ses rattachements/connexions GA4 et Search Console seront retirés. Le widget cessera d’être autorisé sur ce domaine tant que le site n’est pas reconnecté. Le site externe reste conservé.", nextAction: link };
        } catch { return fail("unavailable", "L’action Site Web n’a pas pu être préparée."); }
      } }),
    applyWebsiteReset: tool({ strict: true, description: "Appliquer uniquement la suppression/réinitialisation Site Web prévisualisée et validée. Déconnecte les deux produits Google par leurs routes natives, préserve toute modification concurrente, retire la configuration demandée avec écriture conditionnelle et relit l’état. Signale explicitement une opération partielle, sans la relancer automatiquement.",
      inputSchema: jsonSchema<{ reference: string; approvalQuote: string }>(schema({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, approvalQuote: { type: "string", maxLength: 1200 } })), execute: async raw => {
        const input = fields(raw, ["reference", "approvalQuote"]), reference = str(input.reference);
        if (!hasAssistantActionApproval(options.currentApprovalMessage ?? options.currentUserMessage, str(input.approvalQuote), reference)) return fail("needs_confirmation", "Validez explicitement la référence de suppression/réinitialisation Site Web.");
        const token = options.resolvePreview?.(reference), preview = token && verifyAssistantActionPreview(token, { accountId, actorUserId, kind: "website_reset" });
        if (!preview || preview.reference !== reference || preview.targetId !== "site_web" || !["remove_url", "reset"].includes(str(preview.patch.mode))) return fail("stale_preview", "La préparation a expiré ou ne correspond pas au compte actif.");
        if (!attempts.has(reference)) attempts.set(reference, (async () => {
          const completedProducts: string[] = []; let dispatched = false;
          try {
            const before = await read(); if (before.fingerprint !== preview.fingerprint) return fail("stale_preview", "Le Site Web ou ses connexions ont changé. Préparez à nouveau l’action.");
            for (const product of ["ga4", "gsc"]) {
              if (!await scope()) return fail(completedProducts.length ? "partially_applied" : "blocked", "Le compte actif a changé. Vérifiez les connexions du Site Web.", { completedProducts });
              dispatched = true;
              const response = await (await import("@/app/api/integrations/google-stats/disconnect/route")).POST(nativeRequest(request, "/api/integrations/google-stats/disconnect", { source: "site_web", product })), data = row(await response.json());
              if (!response.ok || data.ok !== true) return fail("partially_applied", "La déconnexion des deux produits Google n’est pas confirmée. Le lien du site n’a pas été effacé par cette étape. Vérifiez le canal avant de reprendre.", { completedProducts });
              completedProducts.push(product);
            }
            const current = await read();
            if (assistantActionFingerprint(withoutGoogle(before.site)) !== assistantActionFingerprint(withoutGoogle(current.site))) return fail("partially_applied", "Les connexions Google ont été retirées, mais la configuration du site a changé pendant l’opération. Son nouveau lien et ses réglages sont conservés.", { completedProducts });
            if (current.integrations.some((value: unknown) => row(value).status !== "disconnected")) return fail("partially_applied", "La relecture ne confirme pas toutes les déconnexions Google. Le lien n’a pas été effacé.", { completedProducts });
            const site = preview.patch.mode === "reset" ? {} : Object.fromEntries(Object.entries(current.site).filter(([key]) => !["url", "domain", "ga4", "gsc"].includes(key)));
            if (!await scope()) return fail("partially_applied", "Le compte actif a changé après les déconnexions Google. Vérifiez le Site Web.", { completedProducts });
            const saved = await current.auth.supabase.from("pro_tools_configs").update({ settings: { ...current.root, site_web: site } }).eq("user_id", accountId).eq("settings", JSON.stringify(current.root)).select("user_id").maybeSingle();
            if (saved.error || saved.data?.user_id !== accountId) return fail("partially_applied", "Les connexions Google ont été retirées mais la configuration du canal a changé. Relisez le Site Web avant de reprendre.", { completedProducts });
            const after = await read();
            if (assistantActionFingerprint(after.site) !== assistantActionFingerprint(site) || after.integrations.some((value: unknown) => row(value).status !== "disconnected")) return fail("saved_unconfirmed", "La relecture ne confirme pas toute la suppression/réinitialisation. Vérifiez le Site Web avant de reprendre.", { completedProducts });
            const response = await (await import("@/app/api/integrations/site-presence/sync/route")).POST();
            await (await import("@/lib/statsCache")).clearAllToolCaches(after.auth.supabase, accountId);
            return { ok: true, status: "saved", mode: preview.patch.mode, connected: false, completedProducts, presenceSyncPending: !response.ok, nextAction: link, message: preview.patch.mode === "reset" ? "La configuration Site Web et ses connexions Google sont réinitialisées et vérifiées." : "Le lien Site Web et ses connexions Google sont retirés et vérifiés." };
          } catch { return fail(dispatched ? "partially_applied" : "unavailable", dispatched ? "L’opération a commencé mais son résultat complet n’est pas confirmé. Vérifiez le Site Web et ses connexions avant de reprendre." : "Le Site Web n’a pas pu être vérifié. Aucune suppression n’a été lancée.", { completedProducts }); }
        })());
        return attempts.get(reference)!;
      } }),
  };
}
