import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./requireUser";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const safe = (value: unknown, max = 240) => sanitizeInrAssistantMemoryText(typeof value === "string" ? value : "", max);
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const VIEWS = ["notifications", "subscription", "credits", "credit_orders", "invoices", "privacy", "referral_program"] as const;
const targetText = (message: string) => inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides"); return input; }
function schema<T>(properties: Record<string, JSONSchema7>, parse: (value: unknown) => T) { return jsonSchema<T>({ type: "object", properties, additionalProperties: false, required: Object.keys(properties) }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Paramètres du compte invalides") }; } } }); }
function instruction(message: string, quote: unknown, operation: "mark" | "download") {
  if (typeof quote !== "string" || !quote.trim() || quote.length > 1200) return false;
  const clean = inrAssistantMaskQuotedText(message), normal = clean.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (!clean.includes(quote) || /^(?:comment|pourquoi|explique|how|why)\b|\b(?:si|if|quand|apres|avant|demain|plus tard|jamais)\b|\bne\b.{0,60}\bpas\b/.test(normal)) return false;
  return operation === "mark" ? /\b(?:marqu\w*|classe\w*)\b/.test(normal) && /\bnotifications?\b/.test(normal) && /\blues?\b/.test(normal) : /\b(?:telecharg\w*|export\w*|download)\b/.test(normal);
}
function nativeRequest(source: Request, path: string, body?: unknown) { const headers = new Headers(); for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); } if (body !== undefined) headers.set("content-type", "application/json"); return new Request(new URL(path, source.url), { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: source.signal }); }
export function createInrAssistantAccountServiceTools(options: { request: Request; accountId: string; actorUserId: string; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; canStartWork?: () => boolean }) {
  const fail = (status: string, message: string) => ({ ok: false, status, message });
  async function scope() { const auth = await requireUser(); return !auth.errorResponse && !options.request.signal.aborted && options.canStartWork?.() !== false && auth.activeUserId === options.accountId && auth.authUserId === options.actorUserId; }
  async function invoices() { const response = await (await import("@/app/api/billing/invoices/route")).GET(); if (!response.ok) throw new Error("invoices_unavailable"); return row(await response.json()); }
  const observedNotifications = new Map<string, string>();
  const mutations = new Map<string, Promise<Row>>();
  return {
    readAccountServices: tool({ strict: true, description: "Lire les services disponibles en Basique : notifications non lues paginées, abonnement du TITULAIRE connecté, crédits/commandes de l’établissement, factures d’abonnement réelles, fonctionnement RGPD/cookies et parrainage. Lecture seule : aucune commande, paiement, changement de plan ou email envoyé. credit_orders paginées en base, jamais route de retour paiement qui déclenche le crédit. Le RGPD exporte tous les établissements du titulaire, sans exposer leurs données au modèle.", inputSchema: schema({ view: { type: "string", enum: [...VIEWS] }, offset: { type: "integer", minimum: 0, maximum: 10000 } }, value => { const input = fields(value, ["view", "offset"]); if (!VIEWS.includes(input.view as never) || !Number.isInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > 10000) throw new Error("Vue invalide"); return { view: String(input.view), offset: Number(input.offset) }; }), execute: async raw => {
      const { view, offset } = raw;
      try {
        if (!await scope()) return fail("blocked", "La session ou l’établissement actif a changé.");
        let result: Row;
        if (view === "notifications") {
          const response = await (await import("@/app/api/notifications/feed/route")).GET(nativeRequest(options.request, `/api/notifications/feed?limit=20&offset=${offset}`)); if (!response.ok) throw new Error("notifications_unavailable"); const data = row(await response.json());
          for (const item of (Array.isArray(data.items) ? data.items : []).map(row)) if (typeof item.id === "string" && UUID.test(item.id)) observedNotifications.set(item.id, safe(item.title, 180));
          result = { items: (Array.isArray(data.items) ? data.items : []).map(row).map(item => ({ id: item.id, title: safe(item.title, 180), body: safe(item.body, 600), category: safe(item.category, 30), createdAt: item.createdAt || item.created_at, unread: item.unread === true })), totalCount: data.countKnown === false ? null : count(data.totalCount), nextOffset: data.nextOffset ?? null, untrustedContent: true };
        } else if (view === "subscription") {
          const data = await options.supabase.from("subscriptions").select("plan,scheduled_plan,status,monthly_price_eur,monthly_price_tax_behavior,start_date,trial_end_at,next_renewal_date,cancel_requested_at,end_date,billing_cycle,billing_provider,native_will_renew").eq("user_id", options.actorUserId).maybeSingle(); if (data.error) throw new Error("subscription_unavailable");
          result = { scope: "authenticated_subscription_holder", subscription: data.data || null, nextAction: { label: "Mon abonnement", href: "/dashboard?panel=abonnement" } };
        } else if (view === "invoices") {
          const data = await invoices(), all = Array.isArray(data.invoices) ? data.invoices.map(row) : [];
          result = { scope: "authenticated_subscription_holder", code: safe(data.code, 80), invoices: all.slice(offset, offset + 20).map(item => ({ id: item.id, number: safe(item.number, 100), status: safe(item.status, 40), currency: safe(item.currency, 3), totalCents: count(item.total), paidCents: count(item.amountPaid), createdAt: count(item.created), periodStart: count(item.periodStart), periodEnd: count(item.periodEnd), pdfAvailable: typeof item.invoicePdf === "string" })), nextOffset: offset + 20 < all.length ? offset + 20 : null, coverage: "native_subscription_invoices_latest_100", nextAction: { label: "Factures d’abonnement", href: "/dashboard?panel=factures" } };
        } else if (view === "credits") {
          const [catalogueRead, quotaRead] = await Promise.allSettled([
            (async () => { const response = await (await import("@/app/api/boutique/video-credits/route")).GET(); return { ok: response.ok, data: row(await response.json()) }; })(),
            (async () => { const response = await (await import("@/app/api/media-generation/quota/route")).GET(); return { ok: response.ok, data: row(await response.json()) }; })(),
          ]);
          const catalogue = catalogueRead.status === "fulfilled" && catalogueRead.value.ok ? catalogueRead.value.data : null;
          const quotaEnvelope = quotaRead.status === "fulfilled" && quotaRead.value.ok && quotaRead.value.data.ok === true ? quotaRead.value.data : null;
          const quota = quotaEnvelope ? row(quotaEnvelope.quota) : null;
          if (catalogue && (catalogue.accountId !== options.accountId || catalogue.actorAuthUserId !== options.actorUserId)
            || quota && quota.accountId !== options.accountId) return fail("blocked", "Le compte de crédits a changé. Aucune valeur d’un autre établissement n’est affichée.");
          const nativeCredits = row(quota?.credits), quotaReady = quota?.creditsReady === true && nativeCredits.unit === "credit";
          const unlimited = quota && typeof quota.unlimited === "boolean" ? quota.unlimited : null;
          const credits = {
            unit: "credit", remaining: quotaReady && typeof nativeCredits.remaining === "number" && Number.isFinite(nativeCredits.remaining) ? nativeCredits.remaining : null,
            limit: quotaReady ? count(nativeCredits.limit) : null, used: quotaReady ? count(nativeCredits.used) : null, reserved: quotaReady ? count(nativeCredits.reserved) : null,
          };
          const quotaKnown = Boolean(quotaReady && credits.used !== null && credits.reserved !== null && (unlimited === true || credits.remaining !== null && credits.limit !== null));
          result = { ok: Boolean(catalogue || quotaKnown), status: catalogue && quotaKnown ? "read" : catalogue || quotaKnown ? "partial" : "unavailable", credits, unlimited, quotaKnown,
            quotaFreshness: quotaKnown ? "native_snapshot" : "unverified", catalogueAvailable: Boolean(catalogue), creditsReady: quota ? quota.creditsReady === true : null,
            packs: (Array.isArray(catalogue?.packs) ? catalogue.packs : []).map(row).map(item => ({ key: safe(item.key, 80), credits: count(item.credits), priceEurHt: count(item.priceEurHt), available: item.available === true })),
            message: quotaKnown ? "Le solde commun est relu par le quota natif du compte actif : restant, plafond, utilisé et réservé. Un mode illimité n’est affirmé que si la route native le confirme. Aucun devis, achat ou travail de génération déclenché."
              : "Le solde natif ne peut pas être confirmé : ses valeurs restent inconnues, jamais remplacées par zéro. Le catalogue éventuellement disponible reste fourni. Aucun devis, achat ou travail de génération déclenché.",
            nextAction: { label: "Boutique", href: "/dashboard?panel=boutique" } };
        } else if (view === "credit_orders") {
          const [videos, images] = await Promise.all(["ai_media_video_credit_orders", "ai_media_image_credit_orders"].map(table => options.supabase.from(table).select(table.includes("video") ? "id,pack_key,seconds,amount_ht_cents,status,granted_at,revoked_seconds,held_seconds,created_at" : "id,pack_key,images,amount_ht_cents,status,granted_at,revoked_images,held_images,created_at").eq("account_id", options.accountId).order("created_at", { ascending: false }).range(offset, offset + 20)));
          if (videos.error || images.error) throw new Error("orders_unavailable");
          const project = (items: unknown, kind: string) => (Array.isArray(items) ? items : []).slice(0, 20).map(row).map(item => ({ id: item.id, kind, pack: safe(item.pack_key, 80), credits: count(kind === "video" ? Number(item.seconds) * 10 : Number(item.images) * 7), amountHtCents: count(item.amount_ht_cents), status: safe(item.status, 40), grantedAt: safe(item.granted_at, 40), createdAt: safe(item.created_at, 40) }));
          result = { videoOrders: project(videos.data, "video"), imageOrders: project(images.data, "image"), nextOffset: (videos.data?.length || 0) > 20 || (images.data?.length || 0) > 20 ? offset + 20 : null, message: "Historique enregistré seulement ; aucune confirmation de paiement ni attribution de crédit exécutée." };
        } else if (view === "privacy") result = { exportScope: "authenticated_holder_all_accessible_establishments", necessaryCookies: "always_enabled", optionalCookies: "analytics_local_browser", nextAction: { label: "Mes données / RGPD", href: "/dashboard?panel=rgpd" }, message: "Le téléchargement RGPD est préparé séparément dans le navigateur. Les données personnelles ne sont pas chargées dans la conversation. Les cookies statistiques se règlent dans le panneau RGPD du navigateur courant." };
        else result = { rewardEur: 50, condition: "Parrainage d’un client engagé au minimum trois mois.", fields: ["name", "phone", "email", "from"], submission: "signed_preview_with_native_receipt", nextAction: { label: "Parrainage", href: "/dashboard?panel=parrainage" }, message: "Préparer les quatre coordonnées via previewReferralSubmission puis confirmer sa référence exacte. Le chemin natif conserve un reçu stable, sans répéter un SMTP incertain. L’acceptation ne prouve pas la livraison." };
        if (!await scope()) return fail("blocked", "L’établissement actif a changé."); return { ok: true, status: "read", view, ...result };
      } catch { return fail("unavailable", "Ces informations du compte ne peuvent pas être vérifiées pour le moment."); }
    } }),
    markNotificationsRead: tool({ strict: true, description: "Marquer comme lues toutes les notifications de l’établissement (notificationIds=null) ou les IDs réels sélectionnés. Demande explicite actuelle requise. Chemin natif idempotent read_at, ne supprime aucune notification et n’envoie aucun message. Relit les lignes ciblées avant d’annoncer le résultat.", inputSchema: schema({ notificationIds: { type: ["array", "null"], minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string", format: "uuid" } }, instructionQuote: { type: "string", maxLength: 1200 } }, value => { const input = fields(value, ["notificationIds", "instructionQuote"]); if (input.notificationIds !== null && (!Array.isArray(input.notificationIds) || !input.notificationIds.length || input.notificationIds.length > 50 || input.notificationIds.some(value => typeof value !== "string" || !UUID.test(value)))) throw new Error("IDs invalides"); return { notificationIds: input.notificationIds as string[] | null, instructionQuote: String(input.instructionQuote) }; }), execute: async input => {
      if (!instruction(options.currentUserMessage, input.instructionQuote, "mark")) return fail("needs_instruction", "Demandez explicitement de marquer ces notifications comme lues.");
      const requested = targetText(options.currentUserMessage);
      const allRequested = /\b(?:toutes? (?:mes |les |nos )?notifications|(?:mes|nos) notifications)\b/.test(requested);
      if (input.notificationIds === null ? !allRequested : input.notificationIds.some(id => !observedNotifications.has(id)
        || !(requested.includes(id.toLowerCase()) || (observedNotifications.get(id)!.length >= 6 && requested.includes(observedNotifications.get(id)!.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()))
          || observedNotifications.size === 1 && /\b(?:cette|la) notification\b/.test(requested)))) return fail("needs_details", "Indiquez toutes les notifications ou la notification exacte déjà lue. Aucun autre élément ne sera marqué.");
      const key = JSON.stringify(input.notificationIds);
      if (!mutations.has(key)) mutations.set(key, (async () => {
        try {
          if (!await scope()) return fail("blocked", "Le compte actif a changé.");
          const { POST } = await import("@/app/api/notifications/mark-all-read/route"), response = await POST(nativeRequest(options.request, "/api/notifications/mark-all-read", input.notificationIds ? { notificationIds: input.notificationIds } : {})); if (!response.ok) return fail("unknown", "La lecture des notifications n’est pas confirmée.");
          let query = options.supabase.from("notifications").select("id").eq("user_id", options.accountId).is("read_at", null); if (input.notificationIds) query = query.in("id", input.notificationIds);
          const remaining = await query.limit(1); if (remaining.error || remaining.data?.length || !await scope()) return fail("unknown", "De nouvelles notifications restent présentes ou le résultat doit être revérifié.");
          return { ok: true, status: "read", message: "Les notifications ciblées sont marquées comme lues. Aucune notification n’a été supprimée." };
        } catch { return fail("unknown", "Le résultat doit être vérifié avant toute nouvelle tentative."); }
      })()); return mutations.get(key)!;
    } }),
    prepareAccountDocumentDownload: tool({ strict: true, description: "Préparer un téléchargement natif dans le navigateur : export RGPD JSON du titulaire et de tous ses établissements, ou PDF d’une facture d’abonnement réelle lue par readAccountServices. Jamais d’URL fournie par le modèle, données privées hors conversation, aucun paiement ou changement d’abonnement. Demande explicite de téléchargement requise ; une transmission au navigateur ne prouve pas un fichier reçu.", inputSchema: schema({ kind: { type: "string", enum: ["account_export", "subscription_invoice"] }, invoiceId: { type: ["string", "null"], maxLength: 124 }, instructionQuote: { type: "string", maxLength: 1200 } }, value => { const input = fields(value, ["kind", "invoiceId", "instructionQuote"]); if (!["account_export", "subscription_invoice"].includes(String(input.kind)) || (input.kind === "account_export" ? input.invoiceId !== null : typeof input.invoiceId !== "string" || !/^in_[a-zA-Z0-9]{1,120}$/.test(input.invoiceId))) throw new Error("Document invalide"); return { kind: String(input.kind), invoiceId: input.invoiceId as string | null, instructionQuote: String(input.instructionQuote) }; }), execute: async input => {
      if (!instruction(options.currentUserMessage, input.instructionQuote, "download")) return fail("needs_instruction", "Demandez explicitement l’export RGPD ou le téléchargement de cette facture.");
      try {
        if (!await scope()) return fail("blocked", "La session a changé.");
        const requested = targetText(options.currentUserMessage);
        if (input.kind === "account_export") {
          if (!/\b(?:rgpd|gdpr)\b|\b(?:mes|nos|les) donnees (?:personnelles|du compte|de mon compte)\b|\bexport (?:de |du |des )?(?:mon compte|mes donnees|mes donnees personnelles|compte)\b/.test(requested)) return fail("needs_instruction", "Demandez explicitement l’export RGPD de vos données personnelles de compte.");
          return { ok: true, status: "ui_action_requested", uiCommand: { command: "download_account_export", selection: { kind: "account_document", id: "account_export" } }, message: "Téléchargement RGPD transmis au navigateur. Cet export concerne le titulaire et tous ses établissements accessibles." };
        }
        if (!/\bfacture\w*\b/.test(requested) || !/\b(?:abonnement|souscription|subscription|inrcy)\b/.test(requested)) return fail("needs_instruction", "Précisez la facture d’abonnement à télécharger.");
        const data = await invoices(), all = (Array.isArray(data.invoices) ? data.invoices : []).map(row), invoice = all.find(item => item.id === input.invoiceId); if (!invoice || typeof invoice.invoicePdf !== "string" || !await scope()) return fail("not_found", "Cette facture PDF n’est pas accessible dans l’abonnement du titulaire.");
        const referenced = requested.includes(String(invoice.id).toLowerCase()) || typeof invoice.number === "string" && invoice.number.length >= 3 && requested.includes(invoice.number.toLowerCase())
          || all.length === 1 || /\b(?:derniere|recente|latest|newest)\b/.test(requested) && all[0]?.id === invoice.id;
        if (!referenced) return fail("needs_details", "Indiquez le numéro de facture ou demandez explicitement la dernière facture d’abonnement.");
        return { ok: true, status: "ui_action_requested", uiCommand: { command: "download_subscription_invoice", selection: { kind: "account_document", id: input.invoiceId }, invoiceId: input.invoiceId }, message: "Ouverture du PDF de la facture exacte demandée au navigateur ; aucun paiement effectué." };
      } catch { return fail("unavailable", "Le document ne peut pas être vérifié."); }
    } }),
    configureCookieConsent: tool({ strict: true, description: "Activer ou désactiver uniquement les cookies statistiques optionnels dans ce navigateur, sur demande explicite actuelle. Réutilise la préférence native RGPD/banner et vérifie son enregistrement local. Les cookies nécessaires restent actifs. Aucune préférence serveur d’un autre appareil n’est modifiée.", inputSchema: schema({ analytics: { type: "boolean" }, instructionQuote: { type: "string", maxLength: 1200 } }, value => { const input = fields(value, ["analytics", "instructionQuote"]); if (typeof input.analytics !== "boolean" || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() || input.instructionQuote.length > 1200) throw new Error("Préférence invalide"); return { analytics: input.analytics, instructionQuote: input.instructionQuote }; }), execute: async input => {
      const clean = inrAssistantMaskQuotedText(options.currentUserMessage), normal = clean.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      const action = input.analytics ? /\b(?:active\w*|autoris\w*|accept\w*|enable)\b/ : /\b(?:desactive\w*|refus\w*|retir\w*|disable)\b/;
      if (!clean.includes(input.instructionQuote) || !action.test(normal) || !/\b(?:cookies?|mesure d['’ ]audience|analytics)\b/.test(normal) || /^(?:comment|pourquoi|explique|how|why)\b|\b(?:si|if|quand|apres|avant|demain|plus tard)\b|\bne\b.{0,40}\bpas\b/.test(normal)) return fail("needs_instruction", "Demandez explicitement d’activer ou désactiver les cookies statistiques optionnels.");
      if (!await scope()) return fail("blocked", "La session a changé.");
      return { ok: true, status: "ui_action_requested", uiCommand: { command: "configure_cookie_consent", selection: { kind: "account_document", id: "cookie_preferences" }, analytics: input.analytics }, message: "Le changement des cookies statistiques est transmis au navigateur. Son enregistrement local sera vérifié." };
    } }),
  };
}
