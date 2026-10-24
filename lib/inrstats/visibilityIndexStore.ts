import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelStates } from "@/lib/channelConnectionState";
import type { InrstatsChannelBlocksByChannel } from "@/lib/inrstats/channelBlocks";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDefaultSnapshotDate } from "@/lib/stats/snapshotWindow";
import { visibilityIndexBasis, visibilityIndexCoefficient, visibilityMetric, VISIBILITY_INDEX_CHANNELS, type VisibilityIndexChannel } from "./visibilityIndexModel";
import { visibilityDay } from "./visibilityIndexSnapshots";
import { measuredStatsVisibility } from "./visibilitySignals";
import { reconcileVisibilityRewards } from "./visibilityIndexRewards";

type OfficialBulk = { period: number; overviews: Record<string, unknown>; blocks: InrstatsChannelBlocksByChannel; meta: { snapshotDate: string | null; generatedAt: string } };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function exactCount(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await query;
  if (error || count === null) throw new Error("visibility_own_stats_unavailable");
  return count;
}
async function ownSignals(db: SupabaseClient, userId: string, now: Date) {
  const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const to = now.toISOString();
  const badge = () => db.from("inrbadge_events").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", from).lt("created_at", to);
  const search = () => db.from("app_events").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("module", "inr_search").gte("created_at", from).lt("created_at", to);
  const [badgeViews, badgeContacts, searchViews, searchContacts] = await Promise.all([
    exactCount(badge().eq("event_type", "view")),
    exactCount(badge().in("event_type", ["lead_submit", "appointment_request"])),
    exactCount(search().eq("type", "page_view")),
    exactCount(search().eq("type", "action_click").in("payload->>actionKey", ["phone", "email", "faq_contact", "lead_form"])),
  ]);
  return { inrbadge: { visibility: badgeViews, contacts: badgeContacts }, inr_search: { visibility: searchViews, contacts: searchContacts } };
}

/** Only called with official server-built 30-day data. No browser counts or scores. */
export async function captureVisibilityIndex(args: { userId: string; bulk: OfficialBulk; channelStates: ChannelStates; activity: unknown; now?: Date }) {
  const now = args.now ?? new Date();
  const day = visibilityDay(now);
  if (args.bulk.period !== 30 || args.bulk.meta.snapshotDate && ![day, getDefaultSnapshotDate(now)].includes(args.bulk.meta.snapshotDate)) return { recorded: false, reason: "historical_request" };
  try {
    const registration = await supabaseAdmin.from("inrstats_visibility_tracking").upsert({ user_id: args.userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (registration.error) throw new Error("visibility_storage_unavailable");
    const { data: accountData, error: accountError } = await supabaseAdmin.from("inrcy_accounts").select("created_at").eq("id", args.userId).maybeSingle();
    if (accountError || !accountData?.created_at) throw new Error("visibility_account_unavailable");
    const coefficient = visibilityIndexCoefficient(accountData.created_at, now);
    if (coefficient === null) throw new Error("visibility_account_date_invalid");
    const own = await ownSignals(supabaseAdmin, args.userId, now);
    const activity = object(args.activity);
    const channels: VisibilityIndexChannel[] = VISIBILITY_INDEX_CHANNELS.map(key => {
      const internal = key === "inrbadge" || key === "inr_search" || key === "mails";
      const block = !internal ? args.bulk.blocks[key] : null;
      const connected = key === "inrbadge" ? true : key === "inr_search" ? args.channelStates.inr_search.connected : key === "mails" ? args.channelStates.mails.connected && !args.channelStates.mails.requiresUpdate : Boolean(block?.connection.statsConnected && !block.connection.requiresUpdate);
      const overview = object(block?.overview ?? args.bulk.overviews[key]);
      const metrics = object(object(object(overview.sources)[key]).metrics);
      if (connected && (block?.error || metrics.error || metrics.needs_reconnect === true)) throw new Error("visibility_provider_unavailable");
      if (connected && block?.snapshotDate && ![day, getDefaultSnapshotDate(now)].includes(block.snapshotDate)) throw new Error("visibility_provider_snapshot_stale");
      const totals = object(metrics.totals);
      let audience: number | null = null;
      for (const field of ["followers", "followers_count", "follower_count", "followerCount", "memberFollowersCount", "fan_count", "fans", "subscribers", "subscriberCount", "audience"]) {
        const candidate = visibilityMetric(totals[field]);
        if (candidate !== null) { audience = candidate; break; }
      }
      const publications = object(activity[key]);
      const posts = publications.publicationHistoryComplete === false ? null : visibilityMetric(object(publications.publications).total);
      return {
        key, connected, ready: true, audience: connected ? audience : null,
        posts: connected ? posts : null,
        visibility: key === "inrbadge" || key === "inr_search" ? own[key].visibility : internal ? null : measuredStatsVisibility(key, overview),
        contacts: key === "inrbadge" || key === "inr_search" ? own[key].contacts : key === "mails" ? null : visibilityMetric(block?.capturedLeads.month),
        potential: internal ? null : visibilityMetric(block?.opportunities),
      };
    });
    const rows = ["all", ...VISIBILITY_INDEX_CHANNELS].map(key => {
      const basis = visibilityIndexBasis(key === "all" ? channels : channels.filter(channel => channel.key === key));
      return { channel_key: key, score: Math.round(basis.base * coefficient * 10000) / 10000, inputs: basis.inputs };
    });
    const saved = await supabaseAdmin.rpc("record_inrstats_visibility_snapshot", { p_user_id: args.userId, p_observed_at: now.toISOString(), p_source_snapshot_date: args.bulk.meta.snapshotDate, p_rows: rows });
    if (saved.error) throw new Error("visibility_snapshot_write_failed");
    try { await reconcileVisibilityRewards(args.userId); }
    catch { console.warn("[inrstats-visibility] Reward reconciliation deferred"); }
    return { recorded: true, reason: "recorded" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "visibility_snapshot_unavailable";
    console.warn("[inrstats-visibility] Capture deferred", { reason });
    return { recorded: false, reason };
  }
}
