export const DASHBOARD_OAUTH_CHANNELS = [
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube_shorts",
  "pinterest",
] as const;

export type DashboardOAuthChannel = (typeof DASHBOARD_OAUTH_CHANNELS)[number];
export type CanonicalConnectionStatus = "connected" | "disconnected" | "needs_update";
export type CanonicalBubbleStatus = "connected" | "available" | "reconnect";

export type CanonicalChannelConnection = {
  connected: boolean;
  connectionStatus?: CanonicalConnectionStatus | null;
  requiresUpdate?: boolean;
  expired?: boolean;
};

export type OfficialDashboardChannelState = Record<string, unknown>;

function canonicalStatus(node: Record<string, any>): CanonicalConnectionStatus {
  const value = node?.connection_status;
  if (value === "connected" || value === "disconnected" || value === "needs_update") return value;
  return node?.connected ? "connected" : "disconnected";
}

function sanitizeConnectedMailCount(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.min(4, Math.round(count))) : 0;
}

/**
 * Validates and normalizes the one server payload used by Dashboard bubbles.
 * A partial/malformed response is rejected instead of turning missing channels
 * into false disconnections.
 */
export function buildOfficialDashboardChannelState(payload: unknown): OfficialDashboardChannelState | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const states = payload as Record<string, any>;
  const hasEveryOAuthChannel = DASHBOARD_OAUTH_CHANNELS.every((channel) => (
    states[channel] && typeof states[channel] === "object" && !Array.isArray(states[channel])
  ));
  if (!hasEveryOAuthChannel || !states.mails || typeof states.mails !== "object") return null;

  const gmb = states.gmb;
  const facebook = states.facebook;
  const instagram = states.instagram;
  const linkedin = states.linkedin;
  const tiktok = states.tiktok;
  const youtube = states.youtube_shorts;
  const pinterest = states.pinterest;
  const tiktokRequiresUpdate = Boolean(tiktok.requiresUpdate || canonicalStatus(tiktok) === "needs_update");
  const youtubeRequiresUpdate = Boolean(youtube.requiresUpdate || canonicalStatus(youtube) === "needs_update");
  const pinterestRequiresUpdate = Boolean(pinterest.requiresUpdate || canonicalStatus(pinterest) === "needs_update");
  const linkedinOrganizationId = String(linkedin.organization_id || "");

  return {
    gmbConnected: Boolean(gmb.connected),
    gmbAccountConnected: Boolean(gmb.accountConnected),
    gmbConfigured: Boolean(gmb.configured),
    gmbConnectionStatus: canonicalStatus(gmb),
    gmbAccountEmail: String(gmb.email || ""),
    gmbLocationName: String(gmb.resource_id || ""),
    gmbLocationLabel: String(gmb.resource_label || ""),
    gmbUrl: String(gmb.url || ""),
    facebookAccountConnected: Boolean(facebook.accountConnected),
    facebookPageConnected: Boolean(facebook.pageConnected),
    facebookConnectionStatus: canonicalStatus(facebook),
    facebookAccountEmail: String(facebook.user_email || ""),
    fbSelectedPageId: String(facebook.resource_id || ""),
    fbSelectedPageName: String(facebook.resource_label || ""),
    facebookUrl: String(facebook.page_url || ""),
    instagramAccountConnected: Boolean(instagram.accountConnected),
    instagramConnected: Boolean(instagram.connected),
    instagramConnectionStatus: canonicalStatus(instagram),
    instagramUsername: String(instagram.username || ""),
    instagramUrl: String(instagram.profile_url || ""),
    linkedinAccountConnected: Boolean(linkedin.accountConnected),
    linkedinConnected: Boolean(linkedin.connected),
    linkedinConnectionStatus: canonicalStatus(linkedin),
    linkedinDisplayName: String(linkedin.display_name || ""),
    linkedinSelectedOrganizationId: linkedinOrganizationId,
    linkedinSelectedOrganizationName: String(linkedin.organization_name || ""),
    linkedinUrl: String(
      linkedinOrganizationId
        ? linkedin.organization_url || linkedin.profile_url || ""
        : linkedin.profile_url || "",
    ),
    tiktokConnected: Boolean(tiktok.connected && !tiktokRequiresUpdate),
    tiktokRequiresUpdate,
    tiktokUsername: String(tiktok.username || ""),
    tiktokProfileUrl: String(tiktok.profile_url || ""),
    youtubeShortsConnected: Boolean(youtube.connected && !youtubeRequiresUpdate),
    youtubeShortsRequiresUpdate: youtubeRequiresUpdate,
    youtubeShortsUrl: String(youtube.channel_url || ""),
    pinterestConnected: Boolean(pinterest.connected && !pinterestRequiresUpdate),
    pinterestRequiresUpdate,
    pinterestUrl: String(pinterest.profile_url || ""),
    mailAccountsConnectedCount: sanitizeConnectedMailCount(states.mails.connectedCount),
    mailAccountsRequireUpdate: Boolean(states.mails.requiresUpdate),
  };
}

/**
 * One projection shared by dashboard semantics, iNrStats semantics and
 * Booster availability. Metric snapshots are deliberately not an input.
 */
export function projectCanonicalChannelConnection(connection: CanonicalChannelConnection) {
  const requiresUpdate = Boolean(
    connection.requiresUpdate ||
      connection.expired ||
      connection.connectionStatus === "needs_update",
  );
  const connected = Boolean(connection.connected && !requiresUpdate);
  const connectionStatus: CanonicalConnectionStatus = requiresUpdate
    ? "needs_update"
    : connected
      ? "connected"
      : "disconnected";

  return {
    bubbleStatus: (requiresUpdate ? "reconnect" : connected ? "connected" : "available") as CanonicalBubbleStatus,
    boosterConnected: connected,
    statsConnected: connected,
    connectionStatus,
  };
}

/**
 * Last-started request wins. A response captured before a connection change,
 * disconnection or active-account switch cannot overwrite the newer state.
 */
export function createLatestChannelResponseGate<Key extends string>() {
  const generations = new Map<Key, number>();
  let scopeGeneration = 0;

  return {
    begin(key: Key) {
      const generation = (generations.get(key) ?? 0) + 1;
      generations.set(key, generation);
      return { generation, scopeGeneration } as const;
    },
    capture(key: Key) {
      return { generation: generations.get(key) ?? 0, scopeGeneration } as const;
    },
    isCurrent(key: Key, token: { generation: number; scopeGeneration: number }) {
      return token.scopeGeneration === scopeGeneration && token.generation === (generations.get(key) ?? 0);
    },
    changeScope() {
      scopeGeneration += 1;
      generations.clear();
    },
  };
}
