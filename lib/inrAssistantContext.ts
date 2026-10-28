import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeBusinessSector } from "./activitySectors.ts";
import {
  DASHBOARD_PROFILE_COMPLETION_SELECT,
  evaluateDashboardProfileCompletion,
  evaluateDashboardActivityCompletion,
} from "./dashboardCompletion.ts";

type RecordValue = Record<string, unknown>;
type ReadResult = { data: unknown; error: unknown };
type SetupSection = { known: boolean; complete: boolean | null; missingFields: string[] };

export type InrAssistantContext = {
  source: "active_account_database";
  business: { company: string; city: string; profession: string; description: string; services: string[] };
  setup: {
    profile: SetupSection;
    activity: SetupSection;
    dna: { known: boolean; saved: boolean | null; completionPercent: number | null; scoreSource: "saved_dna" };
    ai: { known: boolean; configured: boolean | null };
    channels: {
      known: boolean;
      statusSource: "stored_database_not_live_verified";
      storedConnected: string[];
      needsAttention: string[];
      trackedTotal: number;
      projection: "partial_setup_only";
      cockpitTool: "readChannelStatus";
    };
  };
  nextSteps: string[];
};

const CHANNELS = ["site_web", "gmb", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x", "inr_search", "mails"] as const;
const BUSINESS_SELECT = "sector,business_description,services,tone,communication_style,ai_language";
const CONFIG_SELECT = "website:settings->site_web->>url,search_enabled:settings->inrSearch->>enabled,search_slug:settings->inrSearch->>slug";
// Read only connection metadata, never tokens, provider settings or mailbox identities.
const INTEGRATION_SELECT = "source,product,category,status,needs_reconnect:meta->>needs_reconnect,reconnect_required:meta->>reconnect_required,token_invalid:meta->>token_invalid";

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function services(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\n]/) : [];
  return values.filter((item): item is string => typeof item === "string").map(item => text(item, 70)).filter(Boolean).slice(0, 4);
}

function truthy(value: unknown): boolean {
  return value === true || value === "true";
}

async function read(query: () => PromiseLike<unknown>): Promise<ReadResult> {
  try {
    const result = record(await query());
    return { data: result.data ?? null, error: result.error ?? null };
  } catch {
    return { data: null, error: true };
  }
}

function section(result: ReadResult, kind: "profile" | "activity"): SetupSection {
  if (result.error) return { known: false, complete: null, missingFields: [] };
  const completion = kind === "profile"
    ? evaluateDashboardProfileCompletion(record(result.data))
    : evaluateDashboardActivityCompletion(record(result.data));
  return { known: true, complete: completion.completed, missingFields: [...completion.missingFields] };
}

/**
 * Small, read-only projection of the authenticated establishment. The caller
 * must obtain accountId through requireUser, never from the request body.
 * Connection statuses describe saved setup only; no OAuth or provider check runs.
 */
export async function loadInrAssistantContext(args: {
  supabase: Pick<SupabaseClient, "from">;
  accountId: string;
}): Promise<InrAssistantContext> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId || accountId.length > 180) throw new Error("Invalid assistant account scope.");
  const [profileResult, businessResult, memoryResult, configResult, integrationsResult] = await Promise.all([
    read(() => args.supabase.from("profiles").select(DASHBOARD_PROFILE_COMPLETION_SELECT).eq("user_id", accountId).maybeSingle()),
    read(() => args.supabase.from("business_profiles").select(BUSINESS_SELECT).eq("user_id", accountId).order("updated_at", { ascending: false }).limit(1).maybeSingle()),
    read(() => args.supabase.from("business_ai_memories").select("completion_score").eq("account_id", accountId).maybeSingle()),
    read(() => args.supabase.from("pro_tools_configs").select(CONFIG_SELECT).eq("user_id", accountId).maybeSingle()),
    read(() => args.supabase.from("integrations").select(INTEGRATION_SELECT).eq("user_id", accountId).order("updated_at", { ascending: false }).limit(80)),
  ]);
  const profile = profileResult.error ? {} : record(profileResult.data);
  const business = businessResult.error ? {} : record(businessResult.data);
  const config = configResult.error ? {} : record(configResult.data);
  const memory = record(memoryResult.data);
  const score = memory.completion_score;
  const completionPercent = typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100 ? Math.round(score) : null;
  const rows = Array.isArray(integrationsResult.data) ? integrationsResult.data : [];
  // An unexpectedly truncated or malformed result must not become a false zero.
  const channelsKnown = !configResult.error && !integrationsResult.error && Array.isArray(integrationsResult.data) && rows.length < 80;
  const states = new Map<string, "connected" | "attention" | "disconnected">();
  if (channelsKnown) {
    states.set("site_web", text(config.website, 300) ? "connected" : "disconnected");
    states.set("inr_search", truthy(config.search_enabled) && text(config.search_slug, 180) ? "connected" : "disconnected");
    for (const item of rows) {
      const row = record(item);
      const key = row.category === "mail" ? "mails" : text(row.source, 40);
      if (!CHANNELS.some(channel => channel === key) || key === "site_web" || key === "inr_search") continue;
      if (key !== "mails" && row.product !== key) continue;
      const reconnect = [row.needs_reconnect, row.reconnect_required, row.token_invalid].some(value => truthy(value) || (typeof value === "string" && value !== "false" && value.trim() !== ""));
      const status = text(row.status, 40);
      const next = reconnect || ["expired", "needs_update", "needs_reconnect", "revoked", "account_connected"].includes(status)
        ? "attention" : status === "connected" ? "connected" : "disconnected";
      // Rows are newest first; separate mailboxes form one channel with any usable saved connection.
      if (!states.has(key) || (key === "mails" && next === "connected")) states.set(key, next);
    }
  }
  const context: InrAssistantContext = {
    source: "active_account_database",
    business: {
      company: text(profile.company_legal_name, 120), city: text(profile.hq_city, 90),
      profession: text(decodeBusinessSector(text(business.sector, 300)).profession, 100),
      description: text(business.business_description, 400), services: services(business.services),
    },
    setup: {
      profile: section(profileResult, "profile"), activity: section(businessResult, "activity"),
      dna: { known: !memoryResult.error, saved: memoryResult.error ? null : memoryResult.data !== null, completionPercent: memoryResult.error ? null : completionPercent, scoreSource: "saved_dna" },
      ai: { known: !businessResult.error, configured: businessResult.error ? null : [business.tone, business.communication_style, business.ai_language].every(value => Boolean(text(value, 80))) },
      channels: {
        known: channelsKnown, statusSource: "stored_database_not_live_verified",
        storedConnected: CHANNELS.filter(key => states.get(key) === "connected"),
        needsAttention: CHANNELS.filter(key => states.get(key) === "attention"), trackedTotal: CHANNELS.length,
        projection: "partial_setup_only", cockpitTool: "readChannelStatus",
      },
    },
    nextSteps: [],
  };
  if (context.setup.profile.complete === false) context.nextSteps.push("Compléter les informations manquantes dans Mon compte.");
  if (context.setup.activity.complete === false) context.nextSteps.push("Renseigner le secteur et le métier dans l’ADN de l’entreprise.");
  if (channelsKnown && !context.setup.channels.storedConnected.length) context.nextSteps.push("Choisir puis connecter un premier canal depuis Canaux actifs.");
  if (context.setup.channels.needsAttention.length) context.nextSteps.push("Terminer ou actualiser les connexions signalées dans Canaux actifs.");
  if (context.setup.dna.saved === false || (context.setup.dna.completionPercent !== null && context.setup.dna.completionPercent < 100)) context.nextSteps.push("Enrichir l’ADN de l’entreprise avant de préparer des contenus personnalisés.");
  if (context.setup.dna.saved === true && context.setup.dna.completionPercent === null) context.nextSteps.push("Vérifier le contenu enregistré dans l’ADN de l’entreprise : son niveau de préparation n’est pas disponible.");
  if (context.setup.ai.configured === false) context.nextSteps.push("Choisir le ton, le style et la langue dans Configurer mon IA.");
  if (!context.nextSteps.length && Object.values(context.setup).every(value => value.known)) context.nextSteps.push("Préparer un premier contenu dans Booster, puis vérifier ses canaux avant publication.");
  if (Object.values(context.setup).some(value => !value.known)) context.nextSteps.push("Certaines informations n’ont pas pu être vérifiées : ne pas en déduire qu’elles sont absentes ou à zéro.");
  // Bounded fields and fixed arrays keep the serialized prompt below 4,000 characters.
  return context;
}
