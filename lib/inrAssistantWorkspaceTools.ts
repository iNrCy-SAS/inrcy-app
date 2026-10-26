import "server-only";

import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPremiumDashboardAccess, type DashboardEdition } from "./dashboardEdition.ts";
import { currentSubscriptionOffer } from "./subscriptionOffers.ts";
import { VISIBILITY_INDEX_MODEL } from "./inrstats/visibilityIndexModel.ts";

const SECTIONS = ["stats", "subscription", "agents", "crm", "calendar", "reputation", "campaigns", "mail"] as const;
type Section = typeof SECTIONS[number];
type Row = Record<string, unknown>;
type Read = { data: unknown; count: number | null; error: boolean };
const PREMIUM = new Set<Section>(["crm", "calendar", "campaigns", "mail"]);
const SOURCE_TIMEOUT_MS = 5_000;
const GUIDES: Record<Section, { label: string; href: string; guide: string }> = {
  stats: { label: "iNr’Stats", href: "/dashboard/stats", guide: "Consulter Vue globale ou Évolution. Les vues/clics mesurés, l’indice de visibilité et le CA potentiel sont distincts. Créer un bilan envoie réellement un PDF : demander validation avant tout envoi." },
  subscription: { label: "Mon abonnement", href: "/dashboard?panel=abonnement", guide: "Comparer les offres mensuelles/annuelles puis vérifier le récapitulatif avant souscription ou changement. Le contrat réel peut différer du catalogue public. Un achat App Store/Google Play se gère dans sa boutique." },
  agents: { label: "Agents IA", href: "/dashboard/agent/publications", guide: "Ouvrir l’Agent Publications ou Stats, puis Planning ou Réglages. Premium ajoute Agent Emailings. Une lecture ne prépare ni n’active une automatisation ; l’activation et les changements de planning doivent être revus." },
  crm: { label: "iNr’CRM", href: "/dashboard/crm", guide: "Utiliser Rechercher, Filtres ou Ajouter un contact. Les compteurs ci-dessous ne révèlent aucune identité de client ; retrouver une fiche dans le module pour la modifier." },
  calendar: { label: "iNr’Calendar", href: "/dashboard/agenda", guide: "Ouvrir le jour puis l’évènement pour ses détails. Les créneaux retournés sont anonymisés, sans titre, contact ou lieu. Confirmer un rendez-vous ou le supprimer exige une action distincte." },
  reputation: { label: "Réputation", href: "/dashboard/e-reputation", guide: "Ouvrir Réputation, Actualiser les avis puis Détails. Les avis d’exemple ne sont pas de vrais clients. Préparer une réponse ne la publie pas ; vérifier l’avis réel avant Publier la réponse." },
  campaigns: { label: "Campagnes mails", href: "/dashboard?action=campaigns", guide: "Choisir Propulser ou Fidéliser. Suivant prépare la finalisation dans iNr’Send ; vérifier les destinataires avant Envoyer ou Programmer. Les compteurs d’envoi ne prouvent pas une livraison au destinataire." },
  mail: { label: "iNr’Send", href: "/dashboard/mails", guide: "Choisir la boîte et le dossier puis retrouver le message. Une boîte enregistrée connectée n’est pas une vérification en direct. Accepté par la messagerie d’envoi ne signifie pas livré." },
};

const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "" || !["number", "string"].includes(typeof value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : null;
};
const flag = (value: unknown): boolean | null => value === true || value === "true" ? true : value === false || value === "false" ? false : null;
const enumValue = <T extends string>(value: unknown, allowed: readonly T[]): T | null => typeof value === "string" && allowed.includes(value as T) ? value as T : null;
const date = (value: unknown): string | null => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/u.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const rows = (value: Read): Row[] => !value.error && Array.isArray(value.data) ? value.data.map(record).slice(0, 8) : [];

async function read(query: () => PromiseLike<unknown>): Promise<Read> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = record(await Promise.race([
      Promise.resolve(query()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Workspace source unavailable")), SOURCE_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]));
    return { data: result.error ? null : result.data ?? null, count: result.error ? null : number(result.count), error: Boolean(result.error) };
  } catch { return { data: null, count: null, error: true }; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

function parseSection(value: unknown): { section: Section } {
  const input = record(value);
  const section = enumValue(input.section, SECTIONS);
  if (!section || Object.keys(input).length !== 1) throw new Error("Rubrique de l’outil invalide.");
  return { section };
}

/** Read-only metadata. No provider requests, arbitrary URLs, source files or admin client. */
export function createInrAssistantWorkspaceTools(options: {
  supabase: Pick<SupabaseClient, "from">;
  accountId: string;
  edition: DashboardEdition;
  request: Request;
}) {
  const { supabase, edition } = options;
  const accountId = String(options.accountId || "").trim();
  if (!accountId || accountId.length > 180 || !["basic", "standard", "premium", "founder"].includes(edition)) throw new Error("Invalid assistant workspace scope.");
  const query = (table: string, select: string) => supabase.from(table).select(select).eq("user_id", accountId);
  const countQuery = (table: string) => supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", accountId);
  const count = (table: string, configure?: (builder: ReturnType<typeof countQuery>) => ReturnType<typeof countQuery>) => {
    // The callback/table are local constants below, never values supplied by the model.
    const builder = countQuery(table);
    return read(() => configure ? configure(builder) : builder);
  };

  return {
    readWorkspaceSection: tool({
      strict: true,
      description: "Lire les états ACTUELS enregistrés et agrégats anonymisés d’un outil de l’établissement actif : stats, subscription, agents, crm, calendar, reputation, campaigns ou mail. Lecture seule. Aucun nom/email/téléphone de client, message privé, jeton ou contrat n’est retourné. Respecte l’édition. Les sources manquantes sont inconnues, jamais zéro. Stats couvre les évènements internes Badge/Search et l’indice enregistré, pas tous les chiffres sociaux ; Réputation couvre la connexion enregistrée, pas les avis Google en direct. Données bornées et datées, aucune action ni notification n’est déclenchée.",
      inputSchema: jsonSchema<{ section: Section }>({ type: "object", properties: { section: { type: "string", enum: [...SECTIONS] } }, required: ["section"], additionalProperties: false }, {
        validate: (input) => { try { return { success: true, value: parseSection(input) }; } catch (error) { return { success: false, error: error as Error }; } },
      }),
      execute: async (input) => {
        const { section } = parseSection(input);
        const now = new Date();
        const asOf = now.toISOString();
        const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
        const future = new Date(now.getTime() + 30 * 86_400_000).toISOString();
        const base = { source: "active_account_database", readOnly: true, untrustedContent: true, section, asOf, edition, nextAction: GUIDES[section] };
        if ((!hasPremiumDashboardAccess(edition) && PREMIUM.has(section)) || (edition === "basic" && section === "agents")) return {
          ...base, access: "not_included", known: false,
          message: section === "agents"
            ? "Les agents de réalisation sont disponibles avec Standard ou Premium. Aucune donnée privée de cette rubrique n’a été lue ; le guide public reste disponible."
            : "Cette rubrique est réservée Premium. Aucune donnée privée de cette rubrique n’a été lue ; le guide public reste disponible.",
          nextAction: { ...GUIDES[section], href: "/dashboard?help=1" },
        };
        let known = true;
        let data: Row = {};
        const limitations: string[] = ["État enregistré, sans vérification fournisseur en direct. Cette lecture n’effectue aucune modification."];
        if (section === "subscription") {
          const result = await read(() => query("subscriptions", "status,billing_provider,trial_end_at").maybeSingle());
          const row = record(result.data);
          known = !result.error && result.data !== null;
          data = { verifiedEdition: edition, status: known ? enumValue(row.status, ["trial", "trialing", "active", "past_due", "canceled", "cancelled", "unpaid", "expired", "incomplete", "paused", "inactive"]) : null,
            billingProvider: known ? enumValue(row.billing_provider, ["stripe", "app_store", "play_store"]) : null, trialEndAt: known ? date(row.trial_end_at) : null,
            publicCatalogue: (["Basic", "Standard", "Premium"] as const).map(plan => { const offer = currentSubscriptionOffer(plan); return { plan, currency: "EUR", monthly: offer.monthlyPriceEur, yearly: offer.yearlyPriceEur, taxBehavior: offer.taxBehavior, source: "public_catalogue_not_personal_contract" }; }) };
          limitations.push("Aucun prix, identifiant Stripe, document, moyen de paiement ou engagement du contrat personnel n’est lu. Sans ligne liée à l’établissement actif, l’état de l’abonnement du titulaire reste inconnu.");
        } else if (section === "crm") {
          const types = ["client", "prospect", "fournisseur", "partenaire", "autre"] as const;
          const results = await Promise.all([count("crm_contacts"), ...types.map(type => count("crm_contacts", b => b.eq("contact_type", type)))]);
          known = results.every(result => !result.error && result.count !== null);
          data = { total: results[0].count, byType: Object.fromEntries(types.map((type, index) => [type, results[index + 1].count])) };
        } else if (section === "calendar") {
          const result = await read(() => query("agenda_events", "start_at,end_at,all_day,status:meta->>status,source:meta->>source").gte("end_at", asOf).lt("start_at", future).order("start_at", { ascending: true }).limit(8));
          known = !result.error && Array.isArray(result.data);
          data = { period: { from: asOf, to: future }, items: rows(result).map(row => ({ startAt: date(row.start_at), endAt: date(row.end_at), allDay: flag(row.all_day), status: enumValue(row.status, ["draft", "pending", "confirmed", "cancelled", "refused"]), source: enumValue(row.source, ["inrbadge", "google", "manual"]) })), moreItemsMayExist: rows(result).length === 8 };
          limitations.push("Au plus huit prochains créneaux locaux enregistrés sur 30 jours ; ce n’est pas une vérification de disponibilité globale ni une synchronisation Google. Les titres, lieux et invités restent privés.");
        } else if (section === "agents") {
          const keys = edition === "standard" ? ["publish", "stats"] : ["publish", "stats", "grow", "loyalty"];
          const [result, global] = await Promise.all([
            read(() => query("inr_agent_automation_settings", "automation_key,enabled,frequency,validation_mode,next_run_at,last_prepared_at,last_executed_at").in("automation_key", keys).limit(8)),
            read(() => query("inr_agent_settings", "global_enabled").maybeSingle()),
          ]);
          known = !result.error && Array.isArray(result.data) && !global.error && global.data !== null;
          data = { globalEnabled: global.error ? null : flag(record(global.data).global_enabled), items: rows(result).filter(row => keys.includes(String(row.automation_key))).map(row => ({ automation: enumValue(row.automation_key, ["publish", "stats", "grow", "loyalty"]), enabled: flag(row.enabled), frequency: enumValue(row.frequency, ["weekly", "twice_weekly", "three_times_weekly", "biweekly", "three_times_monthly", "monthly", "quarterly", "one_off"]), validationMode: enumValue(row.validation_mode, ["validation_required", "draft_only", "notify_before_validation", "automatic_report"]), nextRunAt: date(row.next_run_at), lastPreparedAt: date(row.last_prepared_at), lastExecutedAt: date(row.last_executed_at) })) };
          limitations.push("Une ligne manquante ne confirme pas les réglages par défaut. Une automatisation individuelle active n’est pas en fonctionnement lorsque globalEnabled est faux. Les destinataires et les actions préparées ne sont pas inclus ; consulter Planning/Réglages avant toute activation.");
        } else if (section === "campaigns") {
          const result = await read(() => query("mail_campaigns", "track_kind,status,total_count,sent_count,created_at,finished_at").gte("created_at", since).order("created_at", { ascending: false }).limit(8));
          known = !result.error && Array.isArray(result.data);
          data = { period: { from: since, to: asOf }, items: rows(result).map(row => ({ kind: enumValue(row.track_kind, ["propulser", "fideliser", "mail"]), status: enumValue(row.status, ["draft", "sent", "error", "queued", "processing", "paused", "partial", "completed", "failed", "cancelled"]), totalRecipients: number(row.total_count), sentCount: number(row.sent_count), createdAt: date(row.created_at), finishedAt: date(row.finished_at) })), moreItemsMayExist: rows(result).length === 8 };
          limitations.push("Huit campagnes récentes au plus, sans objet ni destinataire. Les envois comptés ne sont pas des confirmations de livraison.");
        } else if (section === "mail") {
          const results = await Promise.all([
            count("integrations", b => b.eq("category", "mail")),
            count("integrations", b => b.eq("category", "mail").eq("status", "connected")),
            ...["sent", "draft", "failed", "error"].map(status => count("send_items", b => b.eq("type", "mail").eq("status", status).gte("created_at", since))),
          ]);
          known = results.every(result => !result.error && result.count !== null);
          data = { period: { from: since, to: asOf }, registeredMailboxes: results[0].count, storedConnectedMailboxes: results[1].count, recentMessages: { sent: results[2].count, draft: results[3].count, failed: results[4].count, error: results[5].count } };
          limitations.push("Les messages envoyés depuis iNrCy seulement sont comptés, pas le contenu complet d’une boîte distante. Les adresses, sujets, corps et pièces jointes ne sont pas lus.");
        } else if (section === "reputation") {
          const result = await read(() => query("integrations", "status,needs_reconnect:meta->>needs_reconnect").eq("source", "gmb").eq("product", "gmb").order("updated_at", { ascending: false }).limit(1).maybeSingle());
          const row = record(result.data);
          known = !result.error;
          data = { storedConnectionStatus: !known ? null : row.needs_reconnect === true || row.needs_reconnect === "true" ? "needs_reconnect" : enumValue(row.status, ["connected", "disconnected", "needs_reconnect", "account_connected", "expired", "revoked"]), actualReviewsKnown: false, reviewCount: null, averageRating: null };
          limitations.push("Aucun avis, auteur ou réponse privée n’est lu. L’absence de mesures signifie inconnu, pas zéro avis. Consulter l’outil pour charger les vrais avis Google.");
        } else {
          const counts = await Promise.all([
            count("inrbadge_events", b => b.eq("event_type", "view").gte("created_at", since).lt("created_at", asOf)),
            count("inrbadge_events", b => b.eq("event_type", "action_click").gte("created_at", since).lt("created_at", asOf)),
            count("app_events", b => b.eq("module", "inr_search").eq("type", "page_view").gte("created_at", since).lt("created_at", asOf)),
            count("app_events", b => b.eq("module", "inr_search").eq("type", "action_click").gte("created_at", since).lt("created_at", asOf)),
          ]);
          const snapshots = await read(() => query("inrstats_visibility_snapshots", "observed_on,score").eq("channel_key", "all").eq("model_version", VISIBILITY_INDEX_MODEL.version).order("observed_on", { ascending: false }).limit(8));
          known = counts.every(result => !result.error && result.count !== null) && !snapshots.error && Array.isArray(snapshots.data);
          data = { period: { from: since, to: asOf }, measuredInternalEvents: { inrbadge: { views: counts[0].count, clicks: counts[1].count }, inrSearch: { views: counts[2].count, clicks: counts[3].count } }, visibilityIndex: rows(snapshots).map(row => ({ observedAt: date(row.observed_on), score: number(row.score) })) };
          limitations.push("Les compteurs couvrent uniquement Badge/Search sur les 30 derniers jours, pas les vues de tous les réseaux ni une comparaison par mois civil. L’indice enregistré est un calcul, pas une mesure de vues ; les statistiques sociales, opportunités et CA potentiel ne sont pas lus ici.");
        }
        if (!known) limitations.push("Au moins une source est absente ou indisponible. Les champs nuls sont inconnus ; ne pas en déduire zéro ni une absence de données.");
        const result = { ...base, access: "allowed", known, data, limitations };
        if (JSON.stringify(result).length > 6_000) return { ...base, access: "allowed", known: false, message: "Les données dépassent la limite de lecture. Ouvrir le module pour les vérifier." };
        return result;
      },
    }),
  };
}
