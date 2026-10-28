import "server-only";
import { jsonSchema, tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getChannelConnectionStates } from "./channelConnectionState";
import { isMetaChannelPilotEnabledForActorAndAccount } from "./metaChannelRolloutServer";
import { buildBubbleAccessMap, isBubbleEnabled, type AppBubbleAccessRow } from "./bubbleAccess.ts";
import { isStandardDashboardEdition, type DashboardEdition } from "./dashboardEdition.ts";
import { DASHBOARD_PROFILE_COMPLETION_SELECT, evaluateDashboardProfileCompletion } from "./dashboardCompletion.ts";
import { DASHBOARD_CHANNEL_SETUP, getDashboardChannelSetup, type DashboardSetupChannelKey } from "../app/dashboard/dashboard.channel-setup.ts";
import { requireUser } from "./requireUser";

type Row = Record<string, unknown>;
type Status = "connected" | "disconnected" | "needs_update" | "disabled" | "unknown";
const LABELS: Record<DashboardSetupChannelKey, string> = {
  gmb: "Google Business Profile", site_web: "Site Web", facebook: "Facebook", instagram: "Instagram",
  linkedin: "LinkedIn", tiktok: "TikTok", youtube_shorts: "YouTube", pinterest: "Pinterest", x: "X", threads: "Threads",
  mails: "Mails", inr_search: "iNr’Search", inr_directory: "iNr’Annuaire", inrbadge: "iNr’Badge",
};
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
async function bounded<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Channel source unavailable")), 5_000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function websiteReady(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try { const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`); return ["http:", "https:"].includes(url.protocol) && url.hostname.includes("."); }
  catch { return false; }
}

/** The cockpit registry and canonical connection reader are the same as Dashboard.
 * Only fixed public booleans and prerequisite labels leave this boundary.
 */
export async function readInrAssistantChannelStatus(options: {
  supabase: Pick<SupabaseClient, "from">; accountId: string; edition: DashboardEdition; signal?: AbortSignal;
}) {
  const { supabase, accountId, edition, signal } = options;
  if (signal?.aborted) throw new Error("Channel read cancelled");
  const pilot = await bounded(isMetaChannelPilotEnabledForActorAndAccount(supabase, accountId));
  const results = await Promise.allSettled([
    bounded(getChannelConnectionStates(supabase, accountId, undefined, { metaPilotEnabled: pilot })),
    bounded(supabase.from("profiles").select(DASHBOARD_PROFILE_COMPLETION_SELECT).eq("user_id", accountId).maybeSingle()),
    bounded(supabase.from("app_bubble_access").select("bubble_key,enabled").eq("user_id", accountId)),
  ]);
  if (signal?.aborted) throw new Error("Channel read cancelled");
  const stateResult = results[0], profileResult = results[1], accessResult = results[2];
  const states = stateResult.status === "fulfilled" ? record(stateResult.value) : null;
  const profile = profileResult.status === "fulfilled" && !profileResult.value.error ? record(profileResult.value.data) : null;
  const access = accessResult.status === "fulfilled" && !accessResult.value.error && Array.isArray(accessResult.value.data)
    ? buildBubbleAccessMap(accessResult.value.data as AppBubbleAccessRow[]) : null;
  const profileCompletion = profile ? evaluateDashboardProfileCompletion(profile) : null;
  const channels = getDashboardChannelSetup(pilot).map(({ key }) => {
    let status: Status = "unknown", cause = "source_unavailable";
    let missingPrerequisites: string[] = [];
    const nextAction = { label: `Ouvrir ${LABELS[key]}`, href: key === "inr_directory" ? "/dashboard?action=channels" : `/dashboard?panel=${key}` };
    if (key === "mails" && isStandardDashboardEdition(edition)) { status = "disabled"; cause = "premium_required"; missingPrerequisites = ["Une offre incluant la messagerie"]; nextAction.href = "/dashboard?panel=abonnement"; }
    else if (access && !isBubbleEnabled(access, key)) { status = "disabled"; cause = "account_access_disabled"; missingPrerequisites = ["Activation de ce canal pour cet établissement"]; }
    else if (access && key === "inrbadge" && profileCompletion) {
      status = profileCompletion.completed ? "connected" : "disconnected"; cause = profileCompletion.completed ? "profile_complete" : "profile_incomplete";
      missingPrerequisites = [...profileCompletion.missingFields]; if (!profileCompletion.completed) nextAction.href = "/dashboard?panel=compte";
    } else if (access && states) {
      const state = record(states[key === "inr_directory" ? "inr_search" : key]);
      if (key === "inr_directory" && typeof state.directory_enabled === "boolean") { status = state.directory_enabled ? "connected" : "disconnected"; cause = state.directory_enabled ? "directory_enabled" : "directory_disabled"; }
      else if (key === "site_web" && (typeof state.url === "string" || state.url === null)) { status = websiteReady(state.url) ? "connected" : "disconnected"; cause = status === "connected" ? "website_saved" : "website_missing_or_invalid"; if (status !== "connected") missingPrerequisites = ["Une adresse de site Web valide enregistrée"]; }
      else if (!["inrbadge", "inr_directory", "site_web"].includes(key) && typeof state.connected === "boolean") {
        const needsUpdate = state.requiresUpdate === true || state.expired === true || state.connection_status === "needs_update";
        status = needsUpdate ? "needs_update" : state.connected ? "connected" : "disconnected";
        cause = needsUpdate ? "reconnection_required" : state.connected ? "canonical_connection_saved" : state.accountConnected === true ? "resource_selection_required" : "connection_required";
        missingPrerequisites = needsUpdate ? ["Renouveler la connexion dans le module"] : status === "disconnected" ? [state.accountConnected === true ? "Sélectionner la page ou le profil professionnel dans le module" : "Connecter le compte depuis le module"] : [];
      }
    }
    return { key, label: LABELS[key], status, cause, missingPrerequisites, nextAction };
  });
  const unknown = channels.filter(channel => channel.status === "unknown").map(channel => channel.key);
  const connected = channels.filter(channel => channel.status === "connected");
  return {
    ok: unknown.length === 0, status: unknown.length ? "partial" : "read", source: "canonical_dashboard_state", liveVerified: false,
    checkedAt: new Date().toISOString(), catalogTotal: DASHBOARD_CHANNEL_SETUP.length, visibleTotal: channels.length,
    connectedCount: unknown.length ? null : connected.length, knownConnectedCount: connected.length,
    disconnected: channels.filter(channel => channel.status === "disconnected").map(channel => channel.key),
    needsAttention: channels.filter(channel => channel.status === "needs_update").map(channel => channel.key),
    disabled: channels.filter(channel => channel.status === "disabled").map(channel => channel.key), unknown, channels,
    notice: "État courant relu depuis les mêmes sources que le cockpit, selon les accès de cet établissement. Aucun appel OAuth ni contrôle direct des réseaux externes. Une source inconnue ne signifie pas un canal déconnecté. Les canaux désactivés restent visibles mais ne comptent pas comme connectés.",
  };
}

export function createInrAssistantChannelTools(options: {
  supabase: Pick<SupabaseClient, "from">; accountId: string; edition: DashboardEdition; signal?: AbortSignal;
}) {
  return {
    readChannelStatus: tool({ strict: true,
      description: "Lire exactement les canaux visibles et le compteur du cockpit (catalogue de 14 canaux, Threads selon accès), les canaux déconnectés, à reconnecter ou désactivés et les prérequis connus. Utiliser pour expliquer 12/14, les canaux manquants et leur configuration ; ne pas déduire ce total du contexte simplifié. Lecture seule, aucun compte connecté ou réglage modifié.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {}, required: [], additionalProperties: false }),
      execute: async input => {
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("Lecture des canaux invalide.");
        const auth = await requireUser();
        if (auth.errorResponse || auth.activeUserId !== options.accountId || options.signal?.aborted) return { ok: false, status: "unavailable", message: "Le compte actif n’a pas pu être confirmé. Aucun état de canal annoncé." };
        try { return await readInrAssistantChannelStatus(options); }
        catch { return { ok: false, status: "unavailable", message: "Les canaux ne sont pas vérifiables pour le moment ; aucun compteur ni canal manquant n’est déduit.", nextAction: { label: "Mes canaux", href: "/dashboard?action=channels" } }; }
      },
    }),
  };
}
