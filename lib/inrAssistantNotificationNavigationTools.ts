import "server-only";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "./requireUser";
import { isDashboardDestinationAllowedForEdition, type DashboardEdition } from "./dashboardEdition.ts";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { sanitizeInrAssistantMemoryText } from "./inrAssistantMemory.ts";
import { NOTIFICATION_REMOVAL_SELECT, notificationRemovalFingerprint } from "./notificationRemovalState.ts";
import { toNotificationPayload, type NotificationRow } from "./notifications";
import { getInrAssistantNotificationNavigation, getInrAssistantNotificationTargetForHref, isInrAssistantNotificationActionRequest } from "./inrAssistantNotificationNavigation.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
export { isInrAssistantNotificationActionRequest } from "./inrAssistantNotificationNavigation.ts";
type Row = Record<string, unknown>;
type Input = { notificationId: string | null; title: string | null; instructionQuote: string };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const titleKey = (value: string) => value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr-FR");
const fingerprint = (value: Row) => notificationRemovalFingerprint({ ...value, read_at: null });
const safe = (value: unknown) => sanitizeInrAssistantMemoryText(typeof value === "string" ? value : "", 240);
function input(value: unknown): Input {
  const source = row(value), keys = ["notificationId", "title", "instructionQuote"];
  if (Object.keys(source).length !== keys.length || keys.some(key => !Object.hasOwn(source, key)) || source.notificationId !== null && (typeof source.notificationId !== "string" || !UUID.test(source.notificationId)) || source.title !== null && (typeof source.title !== "string" || !source.title.trim() || source.title.length > 240) || Boolean(source.notificationId) === Boolean(source.title) || typeof source.instructionQuote !== "string" || !source.instructionQuote.trim() || source.instructionQuote.length > 1200) throw new Error("notification_selector_invalid");
  return { notificationId: typeof source.notificationId === "string" ? source.notificationId.toLowerCase() : null, title: typeof source.title === "string" ? source.title.trim() : null, instructionQuote: source.instructionQuote.trim() };
}
function nativeRequest(source: Request, path: string, method: "GET" | "POST" = "GET") {
  const headers = new Headers({ accept: "application/json" });
  for (const key of ["cookie", "authorization"]) { const value = source.headers.get(key); if (value) headers.set(key, value); }
  return new Request(new URL(path, source.url), { method, headers, signal: source.signal });
}

export function createInrAssistantNotificationNavigationTools(options: { request: Request; accountId: string; actorUserId: string; edition: DashboardEdition; supabase: Pick<SupabaseClient, "from">; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  const fail = (status: string, message: string, markedRead = false) => ({ ok: false, status, markedRead, message });
  const attempts = new Map<string, Promise<{ result: Row; notificationId?: string; fingerprint?: string }>>();
  async function scope() { const auth = await requireUser(); return !auth.errorResponse && auth.activeUserId === options.accountId && auth.authUserId === options.actorUserId && !options.request.signal.aborted && options.canStartWork?.() !== false; }
  async function owned(id: string) {
    if (!await scope()) throw new Error("notification_scope_changed");
    const result = await options.supabase.from("notifications").select(NOTIFICATION_REMOVAL_SELECT).eq("id", id).eq("user_id", options.accountId).abortSignal(AbortSignal.timeout(12000)).maybeSingle();
    if (result.error || !result.data || result.data.id !== id || result.data.user_id !== options.accountId || !await scope()) throw new Error("notification_unavailable");
    return row(toNotificationPayload(result.data as NotificationRow));
  }
  async function locate(selector: Input): Promise<{ item?: Row; incomplete?: boolean; ambiguous?: boolean }> {
    let offset = 0; const found = new Map<string, Row>();
    for (let page = 0; page < 10; page++) {
      if (!await scope()) throw new Error("notification_scope_changed");
      const response = await (await import("@/app/api/notifications/feed/route")).GET(nativeRequest(options.request, `/api/notifications/feed?limit=50&offset=${offset}`));
      const payload = row(await response.json());
      if (!response.ok || !Array.isArray(payload.items) || !await scope()) throw new Error("notification_feed_unavailable");
      for (const value of payload.items) {
        const item = row(value);
        if (typeof item.id !== "string" || !UUID.test(item.id) || item.user_id !== options.accountId || item.read_at !== null || item.unread !== true) throw new Error("notification_feed_scope_changed");
        if (selector.notificationId ? item.id.toLowerCase() === selector.notificationId : typeof item.title === "string" && titleKey(item.title) === titleKey(selector.title!)) found.set(item.id, item);
      }
      if (selector.notificationId && found.size === 1) return { item: found.values().next().value };
      if (found.size > 1) return { ambiguous: true };
      if (payload.nextOffset === null || payload.nextOffset === undefined) return { item: found.values().next().value };
      if (!Number.isSafeInteger(payload.nextOffset) || Number(payload.nextOffset) <= offset || Number(payload.nextOffset) > 10000) throw new Error("notification_page_invalid");
      offset = Number(payload.nextOffset);
    }
    return { incomplete: true };
  }
  return { openNotificationAction: tool({ strict: true,
    description: "Ouvrir le bouton d’une notification actuelle du compte actif. Fournir SOIT l’ID littéralement cité par le professionnel, SOIT le titre exact cité et unique dans le flux natif relu. Aucun href, aucune URL ni destination ne sont acceptés du modèle. Relit notification/CTA/propriété, vérifie les droits Basic, marque lue par la route native puis vérifie read_at et la même source avant de demander la navigation canonique. Ne connecte aucun fournisseur, n’ouvre aucun paiement et ne lance aucune publication. L’ouverture n’est confirmée que par l’acquittement du navigateur.",
    inputSchema: jsonSchema<Input>({ type: "object", additionalProperties: false, required: ["notificationId", "title", "instructionQuote"], properties: { notificationId: { type: ["string", "null"], format: "uuid" }, title: { type: ["string", "null"], minLength: 1, maxLength: 240 }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } } }),
    execute: async raw => {
      let selected: Input; try { selected = input(raw); } catch { return fail("needs_instruction", "Citez l’identifiant ou le titre exact d’une seule notification à ouvrir."); }
      const mentioned = (quote: string) => selected.notificationId ? quote.toLowerCase().includes(selected.notificationId) : titleKey(quote).includes(titleKey(selected.title!));
      if (!matchesInrAssistantActionClause(options.currentUserMessage, selected.instructionQuote, (current, quote) => isInrAssistantNotificationActionRequest(current) && isInrAssistantNotificationActionRequest(quote) && mentioned(quote))) return fail("needs_instruction", "Demandez explicitement l’ouverture de cette notification en citant son identifiant ou son titre exact.");
      if (!await scope()) return fail("blocked", "La session ou l’établissement actif a changé.");
      const key = selected.notificationId ?? titleKey(selected.title!);
      const existing = attempts.get(key);
      if (existing) {
        const cached = await existing;
        if (!await scope()) return fail("blocked", "La session ou l’établissement actif a changé.");
        if (cached.notificationId && cached.fingerprint) {
          try { const current = await owned(cached.notificationId); if (fingerprint(current) !== cached.fingerprint || typeof current.read_at !== "string" || !Number.isFinite(Date.parse(current.read_at))) return fail("changed", "Cette notification a changé. Aucune nouvelle ouverture n’est demandée."); }
          catch { return fail("unavailable", "La notification doit être vérifiée à nouveau avant son ouverture."); }
        }
        return cached.result;
      }
      const operation = (async () => {
        try {
          const located = await locate(selected);
          if (located.ambiguous || located.incomplete) return { result: fail("needs_instruction", "Le titre ne permet pas d’identifier une seule notification actuelle. Citez son identifiant exact.") };
          if (!located.item) return { result: fail("not_found", "Cette notification n’est pas présente dans le flux actuel du compte. Elle a pu être lue ou retirée ; aucune ouverture n’est demandée.") };
          const id = String(located.item.id), before = await owned(id), source = fingerprint(located.item);
          if (before.read_at !== null || fingerprint(before) !== source) return { result: fail("changed", "La notification a changé depuis la lecture du flux. Relisez-la avant de l’ouvrir.") };
          const target = getInrAssistantNotificationTargetForHref(before.cta_url);
          const menu = options.clientContext?.interfaces?.find(hint => hint.id === "notification_menu" && hint.operations.includes("close"));
          const navigation = target ? getInrAssistantNotificationNavigation(id, target, menu?.revision) : null;
          if (!navigation || !isDashboardDestinationAllowedForEdition(String(before.cta_url), options.edition) || !isDashboardDestinationAllowedForEdition(navigation.href, options.edition) || typeof before.cta_label !== "string" || !before.cta_label.trim()) return { result: fail("unsupported_destination", "Le bouton de cette notification n’est pas une destination native disponible dans votre pack. Elle reste non lue et aucun lien n’est ouvert.") };
          if (!await scope()) return { result: fail("blocked", "La session ou l’établissement actif a changé avant le marquage.") };
          const response = await (await import("@/app/api/notifications/[id]/read/route")).POST(nativeRequest(options.request, `/api/notifications/${id}/read`, "POST"), { params: Promise.resolve({ id }) });
          const responseData = row(await response.json());
          if (!await scope()) return { result: fail("blocked", "La session ou l’établissement actif a changé ; aucune navigation n’est demandée.") };
          const after = await owned(id), markedRead = typeof after.read_at === "string" && Number.isFinite(Date.parse(after.read_at));
          if (!response.ok || responseData.ok !== true || !markedRead) return { result: fail("unknown", markedRead ? "Le marquage lu est relu, mais la réponse native n’est pas confirmée. Aucune navigation n’est demandée." : "Le marquage lu n’a pas pu être confirmé. Aucune navigation n’est demandée.", markedRead) };
          if (fingerprint(after) !== source || getInrAssistantNotificationTargetForHref(after.cta_url) !== target) return { result: fail("changed", "La notification est marquée lue, mais son contenu ou son bouton a changé. Aucune navigation n’est demandée.", true) };
          if (!await scope()) return { result: fail("blocked", "L’établissement actif a changé ; aucune navigation n’est demandée.") };
          return { notificationId: id, fingerprint: source, result: { ok: true, status: "navigation_requested", markedRead: true, notificationId: id, title: safe(after.title), navigation,
            message: "La notification a été marquée lue par le parcours natif puis relue dans votre compte. L’ouverture de son bouton vérifié est demandée au navigateur ; elle ne sera confirmée qu’après l’affichage effectif de la destination." } };
        } catch { return { result: fail("unavailable", "La notification ou son marquage ne peut pas être vérifié. Aucune navigation n’est demandée.") }; }
      })();
      attempts.set(key, operation);
      return (await operation).result;
    },
  }) };
}
