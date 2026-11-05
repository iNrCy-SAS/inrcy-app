import "server-only";
import { jsonSchema, tool } from "ai";
import type { JSONSchema7 } from "@ai-sdk/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./requireUser";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";
import { inrAssistantMaskQuotedText } from "./inrAssistantRequestClauses.ts";
import { createAssistantActionPreview, verifyAssistantActionPreview, hasAssistantActionApproval } from "./inrAssistantActionPreview.ts";
import { NOTIFICATION_REMOVAL_SELECT, notificationRemovalFingerprint } from "./notificationRemovalState.ts";
import { isInrAssistantExistingCreditOrderReconciliationRequest } from "./inrAssistantCreditOrderReconciliation.ts";
import { nativeInertiaDate, nativeInertiaNumber } from "./inrAssistantBasicShopRead.ts";
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const safe = (value: unknown, max = 240) => sanitizeInrAssistantMemoryText(typeof value === "string" ? value : "", max);
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const VIEWS = ["notifications", "subscription", "credits", "credit_orders", "inertia", "shop_orders", "invoices", "privacy", "referral_program"] as const;
const targetText = (message: string) => inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function fields(value: unknown, keys: string[]) { const input = row(value); if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error("Paramètres invalides"); return input; }
function schema<T>(properties: Record<string, JSONSchema7>, parse: (value: unknown) => T) { return jsonSchema<T>({ type: "object", properties, additionalProperties: false, required: Object.keys(properties) }, { validate: value => { try { return { success: true, value: parse(value) }; } catch { return { success: false, error: new Error("Paramètres du compte invalides") }; } } }); }
function instruction(message: string, quote: unknown, operation: "mark" | "download" | "open") {
  if (typeof quote !== "string" || !quote.trim() || quote.length > 1200) return false;
  const clean = inrAssistantMaskQuotedText(message), normal = clean.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (!clean.includes(quote) || /^(?:comment|pourquoi|explique|how|why)\b|\b(?:si|if|quand|apres|avant|demain|plus tard|jamais)\b|\bne\b.{0,60}\bpas\b|\bn['’]/.test(normal)) return false;
  return operation === "mark" ? /\b(?:marqu\w*|classe\w*)\b/.test(normal) && /\bnotifications?\b/.test(normal) && /\blues?\b/.test(normal) : operation === "open" ? /\b(?:ouvr\w*|affich\w*|montr\w*|consulte\w*|open|view|show)\b/.test(normal) : /\b(?:telecharg\w*|export\w*|download)\b/.test(normal);
}
function nativeRequest(source: Request, path: string, body?: unknown) { const headers = new Headers(); for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); } if (body !== undefined) headers.set("content-type", "application/json"); return new Request(new URL(path, source.url), { method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: source.signal }); }
export function createInrAssistantAccountServiceTools(options: { request: Request; accountId: string; actorUserId: string; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; currentApprovalMessage?: string; resolvePreview?: (reference: string) => string | null; canStartWork?: () => boolean }) {
  const fail = (status: string, message: string) => ({ ok: false, status, message });
  async function scope() { const auth = await requireUser(); return !auth.errorResponse && !options.request.signal.aborted && options.canStartWork?.() !== false && auth.activeUserId === options.accountId && auth.authUserId === options.actorUserId; }
  async function invoices() { const response = await (await import("@/app/api/billing/invoices/route")).GET(); if (!response.ok) throw new Error("invoices_unavailable"); return row(await response.json()); }
  const observedNotifications = new Map<string, string>();
  const mutations = new Map<string, Promise<Row>>();
  const readNotification = async (id: string) => {
    const result = await options.supabase.from("notifications").select(NOTIFICATION_REMOVAL_SELECT).eq("id", id).eq("user_id", options.accountId).maybeSingle();
    if (result.error) throw new Error("notification_unavailable");
    if (result.data && (result.data.id !== id || result.data.user_id !== options.accountId)) throw new Error("notification_scope_changed");
    return result.data as Row | null;
  };
  return {
    readAccountServices: tool({ strict: true, description: "Lire les services Basique : notifications, abonnement/factures du TITULAIRE ; crédits Studio/credit_orders, inertia (solde et journal des Unités d’Inertie UI), shop_orders (commandes de prestations, montants historiques EUR/UI), confidentialité/parrainage. offset=0 puis nextOffset, 20 lignes/page. UI et crédits médias distincts ; montant inconnu=null, statut traité ne prouve pas paiement ni livraison. Lecture seule : aucun achat, débit, email ou réparation de ledger. Ne jamais appeler le retour paiement pour lire un historique.", inputSchema: schema({ view: { type: "string", enum: [...VIEWS] }, offset: { type: "integer", minimum: 0, maximum: 10000 } }, value => { const input = fields(value, ["view", "offset"]); if (!VIEWS.includes(input.view as never) || !Number.isInteger(input.offset) || Number(input.offset) < 0 || Number(input.offset) > 10000) throw new Error("Vue invalide"); return { view: String(input.view), offset: Number(input.offset) }; }), execute: async raw => {
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
          result = { scope: "authenticated_subscription_holder", code: safe(data.code, 80), invoices: all.slice(offset, offset + 20).map(item => ({ id: item.id, number: safe(item.number, 100), status: safe(item.status, 40), currency: safe(item.currency, 3), totalCents: count(item.total), paidCents: count(item.amountPaid), createdAt: count(item.created), periodStart: count(item.periodStart), periodEnd: count(item.periodEnd), pdfAvailable: typeof item.invoicePdf === "string", hostedAvailable: typeof item.hostedInvoiceUrl === "string" })), nextOffset: offset + 20 < all.length ? offset + 20 : null, coverage: "native_subscription_invoices_latest_100", nextAction: { label: "Factures d’abonnement", href: "/dashboard?panel=factures" } };
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
        } else if (view === "inertia") {
          const [balanceRead, ledgerRead] = await Promise.allSettled([
            options.supabase.from("loyalty_balance").select("user_id,balance").eq("user_id", options.accountId).maybeSingle(),
            options.supabase.from("loyalty_ledger").select("id,user_id,created_at,action_key,label,amount").eq("user_id", options.accountId).order("created_at", { ascending: false }).range(offset, offset + 20),
          ]);
          const balanceResult = balanceRead.status === "fulfilled" && !balanceRead.value.error ? balanceRead.value : null, ledgerResult = ledgerRead.status === "fulfilled" && !ledgerRead.value.error && Array.isArray(ledgerRead.value.data) ? ledgerRead.value : null;
          const balanceRow = row(balanceResult?.data), entries = (ledgerResult?.data ?? []).map(row);
          if (balanceResult?.data && balanceRow.user_id !== options.accountId || entries.some(item => item.user_id !== options.accountId)) return fail("blocked", "Les données Inertie ne correspondent pas à l’établissement actif.");
          const balance = nativeInertiaNumber(balanceRow.balance), balanceKnown = balance !== null, ledgerKnown = Boolean(ledgerResult);
          result = { status: balanceKnown && ledgerKnown ? "read" : "partial", scope: "active_establishment", unit: "UI", balance, balanceKnown, ledgerKnown, freshness: balanceKnown && ledgerKnown ? "native_snapshot" : "partially_verified", events: entries.slice(0, 20).map(item => ({ id: safe(item.id, 80), action: safe(item.action_key, 80), label: safe(item.label, 240), amountUi: nativeInertiaNumber(item.amount), createdAt: nativeInertiaDate(item.created_at) })), nextOffset: entries.length > 20 && offset + 20 <= 10000 ? offset + 20 : null, truncated: entries.length > 20 && offset + 20 > 10000, untrustedContent: true, message: "Unités d’Inertie UI de l’établissement, distinctes des crédits Studio. Solde/journal absents ou indisponibles restent inconnus, jamais zéro inventé. Aucun calcul de solde à partir de cette page, réparation, attribution ou débit effectué." };
        } else if (view === "shop_orders") {
          const orders = await options.supabase.from("boutique_orders").select("id,user_id,product_key,product_name,method,amount_eur,amount_eur_tax_behavior,amount_ui,status,created_at").eq("user_id", options.accountId).order("created_at", { ascending: false }).range(offset, offset + 20);
          if (orders.error || !Array.isArray(orders.data)) throw new Error("shop_orders_unavailable");
          const entries = orders.data.map(row); if (entries.some(item => item.user_id !== options.accountId)) return fail("blocked", "Les commandes ne correspondent pas à l’établissement actif.");
          result = { scope: "active_establishment", orders: entries.slice(0, 20).map(item => ({ id: safe(item.id, 80), productKey: safe(item.product_key, 100), productName: safe(item.product_name, 240), method: item.method === "EUR" || item.method === "UI" ? item.method : null, amountEur: nativeInertiaNumber(item.amount_eur, true), eurTaxBehavior: item.amount_eur_tax_behavior === "exclusive" ? "exclusive" : null, amountUi: nativeInertiaNumber(item.amount_ui, true), status: safe(item.status, 40), createdAt: nativeInertiaDate(item.created_at) })), nextOffset: entries.length > 20 && offset + 20 <= 10000 ? offset + 20 : null, truncated: entries.length > 20 && offset + 20 > 10000, untrustedContent: true, message: "Historique des prestations Boutique de l’établissement. Montants enregistrés au moment de la commande, jamais recalculés depuis le catalogue courant ; EUR et UI distincts des crédits médias. Une commande en attente/traitée ne prouve ni règlement bancaire ni exécution/livraison de la prestation. Aucune commande, réservation ou dépense déclenchée." };
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
    reconcileExistingCreditOrder: tool({ strict: true, description: "Actualiser la vérification native d’une commande de recharge déjà existante (image ou video), par ID réel lu dans credit_orders. Aucun achat, checkout ou paiement nouveau. La route native ne comptabilise les crédits qu’après vérification Stripe et conserve son idempotence. Cible citée exactement ou dernière commande réellement vérifiée par date ; aucune quantité fournie ou inventée. Relit ensuite le statut/granted_at, et distingue commande comptabilisée, attente et solde restant.", inputSchema: schema({ kind: { type: "string", enum: ["image", "video"] }, orderId: { type: "string", format: "uuid" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } }, value => { const input = fields(value, ["kind", "orderId", "instructionQuote"]); if (!["image", "video"].includes(String(input.kind)) || typeof input.orderId !== "string" || !UUID.test(input.orderId) || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() || input.instructionQuote.length > 1200) throw new Error("Commande invalide"); return { kind: input.kind as "image" | "video", orderId: input.orderId, instructionQuote: input.instructionQuote }; }), execute: async input => {
      const requested = targetText(options.currentUserMessage), quote = targetText(input.instructionQuote);
      if (!inrAssistantMaskQuotedText(options.currentUserMessage).includes(input.instructionQuote) || !isInrAssistantExistingCreditOrderReconciliationRequest(requested) || !isInrAssistantExistingCreditOrderReconciliationRequest(quote)) return fail("needs_instruction", "Demandez explicitement de vérifier une recharge existante précise. Aucun achat ou paiement n’est lancé.");
      const key = `reconcile:${input.kind}:${input.orderId}`;
      if (!mutations.has(key)) mutations.set(key, (async (): Promise<Row> => {
        try {
          if (!await scope()) return fail("blocked", "La session ou l’établissement a changé.");
          const table = input.kind === "image" ? "ai_media_image_credit_orders" : "ai_media_video_credit_orders";
          const read = async () => { const result = await options.supabase.from(table).select("id,account_id,status,granted_at,created_at").eq("id", input.orderId).eq("account_id", options.accountId).maybeSingle(); if (result.error) throw new Error("order_read_failed"); return result.data; };
          const before = await read(); if (!before || before.id !== input.orderId || before.account_id !== options.accountId) return fail("not_found", "Cette commande n’appartient pas à l’établissement actif.");
          if (!requested.includes(input.orderId.toLowerCase())) {
            if (!/\b(?:derniere|plus recente|latest|newest)\b/.test(requested)) return fail("needs_details", "Indiquez l’ID de la commande ou demandez explicitement la dernière recharge.");
            const namedKind = /\b(?:recharge|commande|credits?)\b.{0,30}\bimages?\b/.test(requested) ? "image" : /\b(?:recharge|commande|credits?)\b.{0,30}\bvideos?\b/.test(requested) ? "video" : null;
            if (namedKind && namedKind !== input.kind) return fail("needs_details", "Le type de recharge demandé ne correspond pas à cette commande.");
            const tables = namedKind ? [table] : ["ai_media_image_credit_orders", "ai_media_video_credit_orders"];
            const lists = await Promise.all(tables.map(name => options.supabase.from(name).select("id,created_at").eq("account_id", options.accountId).order("created_at", { ascending: false }).limit(2)));
            if (lists.some(list => list.error)) throw new Error("orders_read_failed");
            const ordered = lists.flatMap(list => list.data || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            if (!ordered[0] || ordered[0].id !== input.orderId || ordered[1]?.created_at === ordered[0].created_at) return fail("needs_details", "La dernière recharge ne correspond pas à cette cible unique. Indiquez son ID exact.");
          }
          if (!await scope()) return fail("blocked", "La session ou l’établissement a changé.");
          const params = new URLSearchParams({ expectedAccountId: options.accountId, expectedActorUserId: options.actorUserId }), request = nativeRequest(options.request, `/api/boutique/${input.kind}-credits/orders/${input.orderId}?${params}`);
          const route = input.kind === "image" ? await import("@/app/api/boutique/image-credits/orders/[orderId]/route") : await import("@/app/api/boutique/video-credits/orders/[orderId]/route");
          const response = await route.GET(request, { params: Promise.resolve({ orderId: input.orderId }) }), result = row(await response.json()), order = row(result.order);
          if (!response.ok) return fail(response.status === 409 ? "blocked" : "unknown", "La vérification de la commande n’est pas confirmée. Aucun nouvel achat n’est lancé.");
          const after = await read();
          if (!after || after.id !== input.orderId || after.account_id !== options.accountId || order.id !== input.orderId || typeof order.granted !== "boolean" || order.granted !== Boolean(after.granted_at) || order.status !== after.status || !await scope()) return fail("unknown", "Le résultat natif ne correspond pas à sa relecture. Aucun crédit n’est annoncé comme comptabilisé.");
          return { ok: true, status: "read", orderId: input.orderId, kind: input.kind, paymentStatus: safe(after.status, 50), granted: order.granted, credits: count(order.credits), revokedCredits: count(order.revokedCredits), heldCredits: count(order.heldCredits), disputeRevokedCredits: count(order.disputeRevokedCredits),
            message: order.granted ? "La route native et sa relecture confirment que cette commande existante a été comptabilisée. Les retenues/révocations restent distinctes du solde commun disponible. Aucun achat ou paiement nouveau." : "La commande existante a été vérifiée ; son attribution de crédits n’est pas confirmée. Son statut natif reste indiqué, sans inventer de paiement réussi ni crédit disponible." };
        } catch { return fail("unknown", "La vérification reste incertaine. Relisez son statut avant de recommencer ; aucun achat ou crédit inventé."); }
      })()); return mutations.get(key)!;
    } }),
    previewNotificationRemoval: tool({ strict: true, description: "Préparer la suppression d’une notification exacte de l’établissement, déjà identifiée par son ID ou son titre unique dans readAccountServices. Aperçu signé de la cible et de son effet, aucune suppression pendant l’aperçu. Ne supprime ni publication, avis, message fournisseur ni historique associé. Demander ensuite la confirmation exacte IA-… .", inputSchema: schema({ notificationId: { type: "string", format: "uuid" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } }, value => { const input = fields(value, ["notificationId", "instructionQuote"]); if (typeof input.notificationId !== "string" || !UUID.test(input.notificationId) || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() || input.instructionQuote.length > 1200) throw new Error("Notification invalide"); return { notificationId: input.notificationId, instructionQuote: input.instructionQuote }; }), execute: async input => {
      const requested = targetText(options.currentUserMessage), quote = targetText(input.instructionQuote);
      if (!inrAssistantMaskQuotedText(options.currentUserMessage).includes(input.instructionQuote) || !/\b(?:supprim\w*|retire\w*|effac\w*|delete|remove)\b/.test(quote) || !/\bnotifications?\b/.test(quote)
        || /^(?:comment|pourquoi|explique|how|why)\b|\b(?:si|if|quand|apres|avant|demain|plus tard|jamais)\b|\bne\b.{0,60}\bpas\b/.test(requested)) return fail("needs_instruction", "Demandez explicitement la suppression de la notification exacte, puis vérifiez son aperçu.");
      const title = observedNotifications.get(input.notificationId), titleMatches = title && title.length >= 6 && requested.includes(targetText(title)) && [...observedNotifications.values()].filter(value => value === title).length === 1;
      if (!requested.includes(input.notificationId.toLowerCase()) && !titleMatches && !(observedNotifications.size === 1 && observedNotifications.has(input.notificationId) && /\b(?:cette|la) notification\b/.test(requested))) return fail("needs_details", "Lisez puis nommez la notification exacte, ou indiquez son ID. Aucun autre élément ne sera supprimé.");
      try {
        if (!await scope()) return fail("blocked", "La session ou l’établissement actif a changé.");
        const current = await readNotification(input.notificationId); if (!current || !await scope()) return fail("not_found", "Cette notification n’est plus accessible dans l’établissement actif.");
        const preview = createAssistantActionPreview({ accountId: options.accountId, actorUserId: options.actorUserId, kind: "notification_removal", targetId: input.notificationId, fingerprint: notificationRemovalFingerprint(current), patch: {} });
        return { ok: true, status: "preview_ready", approvalKind: "notification_removal", ...preview, proposal: { notificationId: input.notificationId, title: safe(current.title, 180), body: safe(current.body, 600), effect: "Supprime seulement cette notification de l’application. L’événement, la publication et les messages fournisseurs restent intacts." }, message: `Vérifiez la cible puis dites « Confirme ${preview.reference} ».` };
      } catch { return fail("unavailable", "La notification ou la signature d’aperçu ne peut pas être vérifiée. Aucune suppression lancée."); }
    } }),
    applyNotificationRemoval: tool({ strict: true, description: "Supprimer seulement la notification signée après confirmation exacte IA-… . Revérifie acteur, établissement et empreinte avant DELETE natif avec comparaison atomique de l’état, puis relit l’absence. Une notification déjà absente reste un constat sans nouvelle suppression ; un conflit ou résultat incertain n’est jamais annoncé comme une suppression réussie.", inputSchema: schema({ reference: { type: "string", pattern: "^IA-[A-F0-9]{12}$" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } }, value => { const input = fields(value, ["reference", "instructionQuote"]); if (typeof input.reference !== "string" || !/^IA-[A-F0-9]{12}$/.test(input.reference) || typeof input.instructionQuote !== "string" || !input.instructionQuote.trim() || input.instructionQuote.length > 1200) throw new Error("Confirmation invalide"); return { reference: input.reference, instructionQuote: input.instructionQuote }; }), execute: async input => {
      const preview = verifyAssistantActionPreview(options.resolvePreview?.(input.reference) || "", { accountId: options.accountId, actorUserId: options.actorUserId, kind: "notification_removal" });
      if (!preview || preview.reference !== input.reference || !UUID.test(preview.targetId) || !hasAssistantActionApproval(options.currentApprovalMessage || options.currentUserMessage, input.instructionQuote, preview.reference)) return fail("confirmation_required", "Confirmez la référence exacte de la notification présentée dans l’aperçu.");
      const key = `notification_removal:${preview.reference}`;
      if (!mutations.has(key)) mutations.set(key, (async (): Promise<Row> => {
        try {
          if (!await scope()) return fail("blocked", "La session ou l’établissement actif a changé.");
          const current = await readNotification(preview.targetId); if (!await scope()) return fail("blocked", "La session ou l’établissement actif a changé.");
          if (!current) return { ok: true, status: "already_absent", changed: false, message: "Cette notification est déjà absente lors de la relecture. Aucune nouvelle suppression n’a été exécutée." };
          if (notificationRemovalFingerprint(current) !== preview.fingerprint) return fail("conflict", "La notification a changé. Renouvelez l’aperçu avant toute suppression.");
          const path = `/api/notifications/${preview.targetId}`, request = new Request(nativeRequest(options.request, path, { expectedAccountId: options.accountId, expectedActorUserId: options.actorUserId, expectedFingerprint: preview.fingerprint }), { method: "DELETE" });
          const { DELETE } = await import("@/app/api/notifications/[id]/route"), response = await DELETE(request, { params: Promise.resolve({ id: preview.targetId }) });
          if (!response.ok) return fail(response.status === 409 ? "conflict" : "unknown", "La suppression n’est pas confirmée. Revérifiez la notification avant toute nouvelle tentative.");
          const remaining = await readNotification(preview.targetId); if (remaining || !await scope()) return fail("unknown", "L’absence de la notification n’est pas confirmée pour ce compte.");
          return { ok: true, status: "deleted", changed: true, notificationId: preview.targetId, message: "L’absence de la notification exacte est confirmée après sa suppression native. Aucun événement, publication ou message fournisseur n’a été supprimé." };
        } catch { return fail("unknown", "Le résultat doit être relu avant toute nouvelle tentative. Aucune nouvelle suppression automatique n’est lancée."); }
      })()); return mutations.get(key)!;
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
    prepareAccountDocumentDownload: tool({ strict: true, description: "Préparer un document natif : account_export pour export RGPD JSON du titulaire ; subscription_invoice pour télécharger son PDF ; subscription_invoice_hosted pour ouvrir la page Stripe de cette facture d’abonnement exacte lue par readAccountServices. Jamais d’URL modèle ou de paiement. Citation originale avec verbe et facture/numéro exact ou dernière facture. L’ouverture transmise au navigateur ne prouve ni page chargée, fichier reçu ou règlement.", inputSchema: schema({ kind: { type: "string", enum: ["account_export", "subscription_invoice", "subscription_invoice_hosted"] }, invoiceId: { type: ["string", "null"], maxLength: 124 }, instructionQuote: { type: "string", maxLength: 1200 } }, value => { const input = fields(value, ["kind", "invoiceId", "instructionQuote"]); if (!["account_export", "subscription_invoice", "subscription_invoice_hosted"].includes(String(input.kind)) || (input.kind === "account_export" ? input.invoiceId !== null : typeof input.invoiceId !== "string" || !/^in_[a-zA-Z0-9]{1,120}$/.test(input.invoiceId))) throw new Error("Document invalide"); return { kind: String(input.kind), invoiceId: input.invoiceId as string | null, instructionQuote: String(input.instructionQuote) }; }), execute: async input => {
      const hosted = input.kind === "subscription_invoice_hosted", operation = hosted ? "open" : "download";
      if (!instruction(options.currentUserMessage, input.instructionQuote, operation) || hosted && !instruction(input.instructionQuote, input.instructionQuote, "open")) return fail("needs_instruction", "Demandez explicitement l’export RGPD, le téléchargement du PDF ou l’ouverture de cette facture d’abonnement.");
      try {
        if (!await scope()) return fail("blocked", "La session a changé.");
        const requested = targetText(hosted ? input.instructionQuote : options.currentUserMessage);
        if (input.kind === "account_export") {
          if (!/\b(?:rgpd|gdpr)\b|\b(?:mes|nos|les) donnees (?:personnelles|du compte|de mon compte)\b|\bexport (?:de |du |des )?(?:mon compte|mes donnees|mes donnees personnelles|compte)\b/.test(requested)) return fail("needs_instruction", "Demandez explicitement l’export RGPD de vos données personnelles de compte.");
          return { ok: true, status: "ui_action_requested", uiCommand: { command: "download_account_export", selection: { kind: "account_document", id: "account_export" } }, message: "Téléchargement RGPD transmis au navigateur. Cet export concerne le titulaire et tous ses établissements accessibles." };
        }
        if (!/\bfacture\w*\b/.test(requested) || !/\b(?:abonnement|souscription|subscription|inrcy)\b/.test(requested)) return fail("needs_instruction", "Précisez la facture d’abonnement à télécharger.");
        if (hosted && /\bpdf\b/.test(requested)) return fail("needs_instruction", "La demande porte sur un PDF : utilisez le téléchargement de cette facture, distinct de sa page Stripe.");
        if (hosted) {
          const data = await invoices(), all = (Array.isArray(data.invoices) ? data.invoices : []).map(row), invoice = all.find(item => item.id === input.invoiceId);
          if (!await scope()) return fail("blocked", "La session a changé pendant la lecture de la facture.");
          if (!invoice || typeof invoice.hostedInvoiceUrl !== "string" || !invoice.hostedInvoiceUrl) return fail("not_found", "Cette page de facture n’est pas accessible dans l’abonnement du titulaire.");
          const exactReference = (reference: unknown) => typeof reference === "string" && reference.length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}_])${targetText(reference).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}_])`, "u").test(requested);
          if (all.some(item => item.id !== invoice.id && (exactReference(item.id) || exactReference(item.number)))) return fail("needs_details", "La citation vise une autre facture ou plusieurs factures : précisez une seule cible.");
          const referenced = exactReference(invoice.id) || exactReference(invoice.number) || /\b(?:derniere|recente|latest|newest)\b/.test(requested) && all[0]?.id === invoice.id || all.length === 1 && /\bfacture\s+(?:d['’ ]|de l['’ ])?(?:abonnement|souscription|subscription|inrcy)[ .!?]*$/.test(requested);
          if (!referenced) return fail("needs_details", "Indiquez le numéro exact ou demandez explicitement la dernière facture d’abonnement.");
          return { ok: true, status: "ui_action_requested", uiCommand: { command: "open_subscription_invoice_link", selection: { kind: "account_document", id: input.invoiceId }, invoiceId: input.invoiceId }, message: "Ouverture de la page de la facture exacte demandée au navigateur. Aucun paiement effectué ; son chargement n’est pas présumé." };
        }
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
