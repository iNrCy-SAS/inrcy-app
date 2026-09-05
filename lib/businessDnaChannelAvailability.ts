export const BUSINESS_DNA_DASHBOARD_CHANNELS = [
  { key: "site_web", analyzable: true },
  { key: "gmb", analyzable: true },
  { key: "facebook", analyzable: true },
  { key: "instagram", analyzable: true },
  { key: "linkedin", analyzable: true },
  { key: "tiktok", analyzable: true },
  { key: "youtube_shorts", analyzable: true },
  { key: "pinterest", analyzable: true },
  { key: "site_inrcy", analyzable: true },
] as const;

export type BusinessDnaDashboardChannelKey =
  (typeof BUSINESS_DNA_DASHBOARD_CHANNELS)[number]["key"];

export type BusinessDnaDashboardChannelStatus =
  | "connected"
  | "not_connected"
  | "needs_reconnect";

export type BusinessDnaDashboardChannelAvailability = {
  key: BusinessDnaDashboardChannelKey;
  status: BusinessDnaDashboardChannelStatus;
  analyzable: boolean;
};

type DashboardConnectionLike = {
  connected?: unknown;
  expired?: unknown;
  requiresUpdate?: unknown;
  connection_status?: unknown;
};

/**
 * Projects the canonical Dashboard connection state without consulting a
 * previous Business DNA analysis. This keeps the cockpit and the DNA screen
 * on the same connection truth, including the explicit reconnect state.
 */
export function projectBusinessDnaDashboardChannelStatus(
  connection: DashboardConnectionLike | null | undefined,
): BusinessDnaDashboardChannelStatus {
  const needsReconnect = Boolean(
    connection?.requiresUpdate === true ||
      connection?.expired === true ||
      connection?.connection_status === "needs_update",
  );
  if (needsReconnect) return "needs_reconnect";
  return connection?.connected === true ? "connected" : "not_connected";
}

export function buildBusinessDnaDashboardChannelAvailability(args: {
  channelStates: Partial<Record<BusinessDnaDashboardChannelKey, DashboardConnectionLike>>;
}): BusinessDnaDashboardChannelAvailability[] {
  return BUSINESS_DNA_DASHBOARD_CHANNELS.map(({ key, analyzable }) => ({
    key,
    analyzable,
    status: projectBusinessDnaDashboardChannelStatus(args.channelStates[key]),
  }));
}
