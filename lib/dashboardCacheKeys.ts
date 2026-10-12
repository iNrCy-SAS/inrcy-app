/** Reproducible browser snapshots for the single website channel catalogue. */
export const DASHBOARD_CACHE_KEYS = {
  generatorKpis: "inrcy_generator_kpis_v2",
  opportunityTotal: "inrcy_opp30_total_v2",
  lastChannelSync: "inrcy_stats_last_channel_sync_v2",
  channelSyncs: "inrcy_stats_last_channel_syncs_v2",
  dailyBootstrap: "inrcy_daily_stats_bootstrap_ui_v2",
  dashboardServerCheck: "inrcy_dashboard_server_cache_check_ui_v2",
  statsServerCheck: "inrcy_stats_server_cache_check_ui_v2",
  channelState: "inrcy_dashboard_channel_state_v2",
  siteProgress: "site_web_bubble_progress_v3",
  generatorPower: "inrcy_generator_power_percent_v3",
  generatorPowerSnapshot: "inrcy_generator_power_snapshot_v3",
  generatorActive: "inrcy_generator_active_v2",
  bubbleAccess: "inrcy_bubble_access_map_v1",
} as const;

export const DASHBOARD_CACHE_PREFIXES = {
  statsCube: "inrcy_stats_cube_snapshot_v2:",
  statsSummary: "inrcy_stats_summary_snapshot_v3:",
} as const;

/** An old snapshot can never certify freshness for the current catalogue. */
export function hasRetiredWebsiteSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasRetiredWebsiteSnapshot);
  return Object.entries(value).some(([key, entry]) => (
    key === "site_inrcy" || key === "inrcy_site" || key === "siteInrcy" ||
    key === "site_inrcy_ga4" || key === "site_inrcy_gsc" ||
    hasRetiredWebsiteSnapshot(entry)
  ));
}
