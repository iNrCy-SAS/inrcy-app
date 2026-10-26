import "server-only";

import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { isStandardAgentActionDescriptor } from "./standardAgentPolicy.ts";
import { ADS_PUBLIC_CHANNELS } from "./adsAccessPolicy.ts";
import { getAiMediaGenerationPublicError } from "./aiMediaGenerationPublicErrors.ts";
import { readAccountDiagnosticEvents } from "./observability/accountDiagnostics.ts";

const AREAS = ["all", "channels", "publications", "media", "agents", "dna", "campaigns"] as const;
type Area = (typeof AREAS)[number];
type Row = Record<string, unknown>;
type Input = { area: Area; windowHours?: 24 | 168 | null; limit?: number | null };
type Source = { id: string; status: "available" | "unavailable" | "restricted"; found: number; sampled: boolean };
type Incident = {
  area: Area; category: string; status: "failed" | "pending" | "attention";
  occurredAt: string | null; message: string; nextStep: string;
  tool: { name: string; href: string }; channel?: string;
  requestId?: string; route?: string; errorCode?: string;
};
type Read = { rows: Row[]; available: boolean; sampled: boolean };
const SCAN_LIMIT = 16;
const MAX_OUTPUT_CHARS = 6_000;
const SOURCE_TIMEOUT_MS = 5_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CHANNELS: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn", gmb: "Google Business",
  site_web: "Site Web", inr_search: "iNr’Search", tiktok: "TikTok", youtube_shorts: "YouTube", pinterest: "Pinterest", x: "X",
};
const TOOLS: Record<Area, Incident["tool"]> = {
  all: { name: "Accueil", href: "/dashboard" },
  channels: { name: "Mes canaux", href: "/dashboard?action=channels" },
  publications: { name: "iNr’Send", href: "/dashboard/mails?folder=publications&boxView=sent" },
  media: { name: "iNr’Studio", href: "/dashboard/generer-media" },
  agents: { name: "Agent Publications", href: "/dashboard/agent/publications" },
  dna: { name: "ADN de l’entreprise", href: "/dashboard/adn-entreprise" },
  campaigns: { name: "iNr’Send", href: "/dashboard/mails" },
};

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
function normalized(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 1_200).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() : "";
}
function date(value: unknown, now: number): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now + 60_000 ? new Date(time).toISOString() : null;
}
function recent(value: unknown, since: number, now: number): string | null {
  const parsed = date(value, now);
  return parsed && Date.parse(parsed) >= since ? parsed : null;
}
function parse(value: unknown): { area: Area; windowHours: 24 | 168; limit: number } {
  const input = record(value);
  if (Object.keys(input).some((key) => !["area", "windowHours", "limit"].includes(key)) ||
    !AREAS.includes(input.area as Area) ||
    (input.windowHours != null && input.windowHours !== 24 && input.windowHours !== 168) ||
    (input.limit != null && (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 8))) {
    throw new Error("Critères de diagnostic invalides.");
  }
  return { area: input.area as Area, windowHours: input.windowHours === 24 ? 24 : 168, limit: Number(input.limit ?? 5) };
}
async function bounded<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Diagnostic source unavailable")), SOURCE_TIMEOUT_MS); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
async function read(query: () => PromiseLike<unknown>, cap = SCAN_LIMIT): Promise<Read> {
  try {
    const result = record(await bounded(query()));
    if (result.error || !Array.isArray(result.data)) return { rows: [], available: false, sampled: false };
    return { rows: result.data.slice(0, cap).map(record), available: true, sampled: result.data.length >= cap };
  } catch { return { rows: [], available: false, sampled: false }; }
}

/** Raw errors are classification inputs only. All returned wording is fixed. */
function explanation(raw: unknown, statusCode?: number): Pick<Incident, "category" | "message" | "nextStep"> {
  const object = record(raw);
  const text = [normalized(raw), normalized(object.code), normalized(object.message)].join(" ");
  if (/needs.reconnect|invalid.grant|token.expir|expired.token|unauthori[sz]ed|oauth|reconnect|connexion.*expir/.test(text) || statusCode === 401) {
    return { category: "connection_required", message: "Une autorisation ou une session n’a pas été reconnue lors de cette tentative.", nextStep: "Vérifiez la session et l’état du canal concerné ; reconnectez-le seulement si l’interface le demande." };
  }
  if (/permission|scope|forbidden|acces.*refus|autorisation.*insuff/.test(text) || statusCode === 403) {
    return { category: "access_required", message: "Une permission ou un accès nécessaire manque pour cette opération.", nextStep: "Vérifiez les droits du compte, le forfait et les autorisations du canal dans l’outil concerné." };
  }
  if (/rate.limit|too.many.requests|trop.de.demandes/.test(text) || statusCode === 429) {
    return { category: "rate_limited", message: "Une limite temporaire de requêtes a été rencontrée.", nextStep: "Attendez avant de réessayer ; évitez de multiplier les mêmes opérations." };
  }
  if (/quota|credit|budget|insufficient.balance/.test(text)) {
    return { category: "quota_or_budget", message: "Un contrôle de quota ou de budget a empêché cette tentative.", nextStep: "Consultez le compteur et le message de l’outil ; ce constat ne prouve ni débit ni remboursement." };
  }
  if (/timeout|timed.out|deadline|delai|aborted/.test(text) || statusCode === 504) {
    return { category: "timeout", message: "La tentative n’a pas obtenu de résultat dans le délai disponible.", nextStep: "Vérifiez d’abord son état actuel pour éviter un doublon avant toute nouvelle tentative." };
  }
  if (/format|mime|duration|dimension|codec|media.*invalid|unsupported/.test(text)) {
    return { category: "media_format", message: "Le format ou un paramètre du média n’a pas été accepté.", nextStep: "Vérifiez le format, la durée et les contraintes affichées dans l’outil concerné." };
  }
  if (/moderat|content.policy|safety|refus.*securite/.test(text)) {
    return { category: "content_rejected", message: "Le service a refusé un contenu ou une référence lors de ses contrôles.", nextStep: "Relisez le message de l’outil et adaptez le contenu ou la référence ; ne relancez pas à l’identique." };
  }
  if ((statusCode != null && statusCode >= 500) || /unavailable|service.*indisponible|network|econn/.test(text)) {
    return { category: "service_unavailable", message: "Un service nécessaire était indisponible lors de cette tentative.", nextStep: "Vérifiez le suivi de l’opération puis réessayez plus tard ; contactez l’assistance si cela persiste." };
  }
  return { category: "recorded_failure", message: "Un échec est enregistré, mais les éléments disponibles ne permettent pas d’en confirmer la cause.", nextStep: "Ouvrez le suivi de l’opération et relevez l’heure ainsi que la référence de requête disponible pour l’assistance." };
}

function eventLocation(route: unknown): { area: Area; route: string } {
  const path = typeof route === "string" ? route.split(/[?#]/, 1)[0] : "";
  const families: Array<[RegExp, Area, string]> = [
    [/^\/api\/(?:integrations|oauth|auth)(?:\/|$)/, "channels", "/api/integrations/…"],
    [/^\/api\/(?:media-generation|media-library|media-pipeline)(?:\/|$)/, "media", "/api/media-generation/…"],
    [/^\/api\/ai-memory(?:\/|$)/, "dna", "/api/ai-memory/…"],
    [/^\/api\/(?:ads|propulser|fideliser)(?:\/|$)|^\/api\/crm\/campaigns(?:\/|$)/, "campaigns", "/api/campaigns/…"],
    [/^\/api\/agent(?:\/|$)/, "agents", "/api/agent/…"],
    [/^\/api\/booster(?:\/|$)|^\/api\/inrsend\/publications(?:\/|$)/, "publications", "/api/booster/…"],
  ];
  const family = families.find(([pattern]) => pattern.test(path));
  return family ? { area: family[1], route: family[2] } : { area: "all", route: "/api/…" };
}

/** Account scope is captured from requireUser by the caller, never from a model argument. */
export function createInrAssistantDiagnosticsTools(options: {
  supabase: Pick<SupabaseClient, "from">;
  accountId: string;
  edition: DashboardEdition;
}) {
  const accountId = String(options.accountId || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,179}$/i.test(accountId) || !["standard", "premium", "founder"].includes(options.edition)) {
    throw new Error("Périmètre de diagnostic indisponible.");
  }
  const { supabase, edition } = options;
  return {
    getAccountDiagnostics: tool({
      strict: true,
      description: "Consulter les erreurs et états techniques RÉELLEMENT enregistrés pour l’établissement actif, en lecture seule. Au plus huit signaux récents sur 24 heures ou sept jours, sans journaux Vercel globaux, secrets ni autre compte. Ne pas conclure à une panne ou un succès en direct : ce sont des états datés. Une source indisponible reste inconnue ; une absence de signal ne prouve pas que tout fonctionne. N’exécute aucune réparation ni relance.",
      inputSchema: jsonSchema<Input>({
        type: "object", properties: {
          area: { type: "string", enum: [...AREAS] },
          windowHours: { type: ["integer", "null"], enum: [24, 168, null] },
          limit: { type: ["integer", "null"], minimum: 1, maximum: 8 },
        }, required: ["area", "windowHours", "limit"], additionalProperties: false,
      }, { validate: (value) => { try { return { success: true, value: parse(value) }; } catch (error) { return { success: false, error: error as Error }; } } }),
      execute: async (value) => {
        const input = parse(value);
        const now = Date.now(), since = now - input.windowHours * 60 * 60 * 1_000, sinceIso = new Date(since).toISOString();
        const sources: Source[] = [], items: Incident[] = [];
        const wants = (area: Area) => input.area === "all" || input.area === area;
        const addSource = (id: string, result: Read) => sources.push({ id, status: result.available ? "available" : "unavailable", found: result.rows.length, sampled: result.sampled });
        const add = (area: Area, occurredAt: string | null, raw: unknown, extra: Partial<Incident> = {}) => items.push({
          area, occurredAt, status: "failed", tool: TOOLS[area], ...explanation(raw), ...extra,
        });
        const tasks: Promise<void>[] = [];

        tasks.push((async () => {
          try {
            const stored = await bounded(readAccountDiagnosticEvents(accountId));
            if (!stored.available || !Array.isArray(stored.events)) throw new Error("unavailable");
            const events = stored.events.slice(0, 80).filter((event) => {
              const location = eventLocation(event.route);
              if (edition === "standard" && (location.area === "campaigns" || /^\/api\/agent\/actions\/prepare-campaign(?:\/|$)/.test(event.route))) return false;
              return recent(event.occurredAt, since, now) && (wants(location.area) || input.area === "all");
            });
            sources.push({ id: "server_events", status: "available", found: events.length, sampled: stored.events.length >= 80 });
            for (const event of events) {
              const at = recent(event.occurredAt, since, now), location = eventLocation(event.route);
              if (!at || (!wants(location.area) && input.area !== "all") || !Number.isInteger(event.statusCode) || event.statusCode < 400 || event.statusCode > 599) continue;
              const diagnosis = explanation(event.errorCode, event.statusCode);
              const requestId = UUID.test(event.requestId) && !event.requestId.toLowerCase().includes(accountId.toLowerCase()) ? event.requestId : undefined;
              const route = typeof event.route === "string" && /^\/api\/[a-z0-9_/\[\]-]{1,210}$/i.test(event.route) && !event.route.includes(accountId)
                ? event.route : location.route;
              add(location.area, at, null, { ...diagnosis, errorCode: diagnosis.category, route, ...(requestId ? { requestId } : {}) });
            }
          } catch { sources.push({ id: "server_events", status: "unavailable", found: 0, sampled: false }); }
        })());

        if (wants("channels")) tasks.push((async () => {
          const result = await read(() => supabase.from("integrations").select("provider,source,product,status,updated_at,needs_reconnect:meta->>needs_reconnect,needs_reconnect_at:meta->>needs_reconnect_at").eq("user_id", accountId).order("updated_at", { ascending: false }).limit(32), 32);
          addSource("channels", result);
          for (const row of result.rows) {
            const key = [row.product, row.source, row.provider].find((entry) => typeof entry === "string" && entry in CHANNELS) as string | undefined;
            if (!key) continue;
            const state = normalized(row.status);
            if (row.needs_reconnect !== "true" && !["expired", "revoked", "disconnected", "error", "invalid"].includes(state)) continue;
            add("channels", date(row.needs_reconnect_at || row.updated_at, now), "needs_reconnect", { status: "attention", channel: CHANNELS[key], message: "Le canal présente un état enregistré à vérifier ou à reconnecter. Aucun test fournisseur en direct n’a été effectué." });
          }
        })());

        if (wants("publications")) tasks.push((async () => {
          const publications = await read(() => supabase.from("publications").select("id,created_at").eq("user_id", accountId).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(SCAN_LIMIT));
          if (!publications.available) { addSource("publications", publications); return; }
          const dated = publications.rows.filter((row) => recent(row.created_at, since, now));
          const ids = dated.map((row) => row.id).filter((id): id is string => typeof id === "string" && id.length <= 80);
          const deliveries = ids.length ? await read(() => supabase.from("publication_deliveries").select("publication_id,channel,status,error").eq("user_id", accountId).in("publication_id", ids).limit(128), 128) : { rows: [], available: true, sampled: false };
          addSource("publications", { ...deliveries, sampled: publications.sampled || deliveries.sampled });
          for (const row of deliveries.rows) {
            const parent = dated.find((publication) => publication.id === row.publication_id), channel = typeof row.channel === "string" ? CHANNELS[row.channel] : undefined;
            if (!parent || !channel) continue;
            const status = normalized(row.status);
            if (["failed", "error"].includes(status)) add("publications", date(parent.created_at, now), row.error, { channel });
            else if (["pending", "queued", "processing", "publish_unknown"].includes(status)) add("publications", date(parent.created_at, now), null, { channel, status: "pending", category: "publication_pending", message: "La publication possède un état enregistré encore en attente ou en traitement pour ce canal.", nextStep: "Ouvrez iNr’Send et actualisez le statut avant de retenter ; l’état enregistré ne confirme pas une publication en direct." });
          }
        })());

        if (wants("media")) {
          tasks.push((async () => {
            const result = await read(() => supabase.from("ai_media_generation_jobs").select("status,error_code,error_message,created_at,updated_at").eq("account_id", accountId).gte("updated_at", sinceIso).order("updated_at", { ascending: false }).limit(SCAN_LIMIT));
            addSource("media_generations", result);
            for (const row of result.rows) {
              const at = recent(row.updated_at || row.created_at, since, now), status = normalized(row.status);
              if (!at) continue;
              if (["failed", "expired"].includes(status)) {
                const publicError = getAiMediaGenerationPublicError({ code: row.error_code, message: row.error_message }, { expired: status === "expired" });
                add("media", at, null, { category: "media_generation_failed", errorCode: publicError.code, message: publicError.reason.slice(0, 240), nextStep: publicError.action.slice(0, 180) });
              } else if (["reserved", "processing"].includes(status)) add("media", at, null, { category: "media_generation_pending", status: "pending", message: "La génération est encore réservée ou en traitement selon l’état enregistré ; cela ne prouve pas qu’elle est bloquée.", nextStep: "Consultez le suivi dans iNr’Studio avant de lancer une nouvelle génération payante." });
            }
          })());
          tasks.push((async () => {
            const result = await read(() => supabase.from("pro_media_library").select("upload_status,processing_status,processing_error_code,created_at,updated_at").eq("user_id", accountId).gte("updated_at", sinceIso).order("updated_at", { ascending: false }).limit(SCAN_LIMIT));
            addSource("media_processing", result);
            for (const row of result.rows) {
              const at = recent(row.updated_at || row.created_at, since, now);
              if (at && (row.upload_status === "failed" || ["failed", "failed_retryable", "failed_terminal"].includes(normalized(row.processing_status)))) {
                add("media", at, row.processing_error_code, { tool: { name: "Mes médias", href: "/dashboard/mediatheque" } });
              }
            }
          })());
        }

        if (wants("agents")) for (const [table, source] of [["inr_agent_actions", "agent_actions"], ["inr_agent_scheduled_actions", "agent_schedule"]] as const) tasks.push((async () => {
          const result = await read(() => supabase.from(table).select("automation_key,action_type,target_tool,status,last_error,created_at,updated_at").eq("user_id", accountId).gte("updated_at", sinceIso).order("updated_at", { ascending: false }).limit(SCAN_LIMIT));
          const visibleRows = edition === "standard" ? result.rows.filter(isStandardAgentActionDescriptor) : result.rows;
          addSource(source, { ...result, rows: visibleRows });
          for (const row of visibleRows) {
            const at = recent(row.updated_at || row.created_at, since, now), state = normalized(row.status);
            const target = row.target_tool === "inrstats" ? { name: "Agent Stats", href: "/dashboard/agent/stats" }
              : row.target_tool === "propulser" || row.target_tool === "fideliser" ? { name: "Agent Emailings", href: "/dashboard/agent/campagnes-mails" } : TOOLS.agents;
            if (at && state === "failed") add("agents", at, row.last_error, { tool: target });
          }
        })());

        if (wants("dna")) tasks.push((async () => {
          try {
            // The existing helper is account-scoped and read-only. The table is
            // intentionally server-only; no auth-client-to-admin fallback exists.
            const { getBusinessDnaManualAnalysisJob } = await import("./businessDnaManualAnalysisJobs.ts");
            const row = record(await bounded(getBusinessDnaManualAnalysisJob(accountId)));
            // The helper also returns null during an unavailable migration, so
            // absence cannot safely be reported as a verified empty history.
            if (!row.id || row.account_id !== accountId) throw new Error("unknown");
            sources.push({ id: "dna_analysis", status: "available", found: 1, sampled: false });
            const at = recent(row.updated_at || row.created_at, since, now), status = normalized(row.status);
            if (at && status === "failed") add("dna", at, null, { category: "dna_analysis_failed", message: "La dernière analyse ADN s’est terminée en échec selon l’état enregistré.", nextStep: "Ouvrez Analyse dans l’ADN pour son suivi ; ce diagnostic ne confirme pas le solde ni un remboursement de quota." });
            else if (at && ["queued", "running"].includes(status)) add("dna", at, null, { status: "pending", category: "dna_analysis_pending", message: "La dernière analyse ADN est encore en file ou en cours selon l’état enregistré.", nextStep: "Consultez son suivi avant de relancer une analyse." });
          } catch { sources.push({ id: "dna_analysis", status: "unavailable", found: 0, sampled: false }); }
        })());

        if (wants("campaigns")) {
          if (edition === "standard") sources.push({ id: "campaigns", status: "restricted", found: 0, sampled: false });
          else for (const table of ["mail_campaigns", "ads_campaigns"] as const) tasks.push((async () => {
            const result = await read(() => {
              let query = supabase.from(table).select(table === "ads_campaigns" ? "provider,status,last_error,created_at,updated_at" : "status,last_error,created_at,updated_at").eq("user_id", accountId).gte("updated_at", sinceIso);
              // Diagnostics never widens the public Ads catalogue to pilot accounts.
              if (table === "ads_campaigns") query = query.in("provider", [...ADS_PUBLIC_CHANNELS]);
              return query.order("updated_at", { ascending: false }).limit(SCAN_LIMIT);
            });
            addSource(table, result);
            for (const row of result.rows) {
              const at = recent(row.updated_at || row.created_at, since, now), status = normalized(row.status);
              if (at && ["failed", "partial", "paused", "publish_unknown", "publishing_unknown"].includes(status)) add("campaigns", at, row.last_error, { status: status === "failed" ? "failed" : "attention", tool: table === "ads_campaigns" ? { name: "iNr’ADS", href: "/dashboard/ads" } : TOOLS.campaigns });
            }
          })());
        }

        await Promise.all(tasks);
        const distinct = new Map<string, Incident>();
        for (const item of items) {
          const key = [item.area, item.category, item.status, item.channel || "", item.requestId || "", item.occurredAt || "", item.tool.href].join("|");
          if (!distinct.has(key)) distinct.set(key, item);
        }
        const sorted = [...distinct.values()].sort((a, b) => (Date.parse(b.occurredAt || "") || 0) - (Date.parse(a.occurredAt || "") || 0));
        sources.sort((a, b) => a.id.localeCompare(b.id));
        const available = sources.some((source) => source.status === "available");
        const complete = sources.every((source) => source.status !== "unavailable");
        const response = {
          source: "active_account_diagnostics", ok: available && (complete || sorted.length > 0), complete, checkedAt: new Date(now).toISOString(), windowHours: input.windowHours,
          liveVerified: false, serverEventRetentionDays: 7, sources, items: sorted.slice(0, input.limit), truncated: sorted.length > input.limit,
          message: !available ? "Les sources de diagnostic sont indisponibles ou inaccessibles. L’absence de résultat ne signifie pas absence de problème."
            : !complete && !sorted.length ? "Diagnostic incomplet : certains états n’ont pas pu être vérifiés. L’absence de signal dans les autres sources ne confirme pas l’absence de problème."
            : sorted.length ? "Signaux enregistrés pour cet établissement ; les pistes proposées ne sont pas des causes confirmées en direct."
              : "Aucun signal trouvé dans les sources consultables et leur fenêtre de lecture ; cela ne prouve pas que tout fonctionne. Les sources indisponibles restent inconnues.",
        };
        while (JSON.stringify(response).length > MAX_OUTPUT_CHARS && response.items.length) { response.items.pop(); response.truncated = true; }
        return response;
      },
    }),
  };
}
