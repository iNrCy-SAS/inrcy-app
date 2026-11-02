import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";

export function isConnectionStatus(value: unknown): value is ConnectionDisplayStatus {
  return value === "connected" || value === "disconnected" || value === "needs_update";
}

/** Project a confirmed mutation without reading or writing browser state. */
export function normalizeDashboardConnectionPatch(patch: Partial<InrstatsChannelBlock["connection"]>) {
  const requiresUpdate = Boolean(
    patch.requiresUpdate || patch.expired || patch.connectionStatus === "needs_update",
  );
  const inferredStatus = requiresUpdate
    ? "needs_update"
    : typeof patch.connected === "boolean"
      ? patch.connected ? "connected" : "disconnected"
      : patch.connectionStatus;
  const normalizedPatch: Partial<InrstatsChannelBlock["connection"]> = {
    ...patch,
    ...(typeof inferredStatus === "string" ? { connectionStatus: inferredStatus } : {}),
    ...(typeof patch.connected === "boolean" ? {
      requiresUpdate,
      expired: requiresUpdate ? Boolean(patch.expired) : false,
    } : {}),
  };
  return { normalizedPatch, requiresUpdate };
}

export function projectDashboardConnectionCachePatch(
  channel: DashboardChannelKey,
  normalizedPatch: Partial<InrstatsChannelBlock["connection"]>,
  requiresUpdate: boolean,
  cachedSiteState: Record<string, unknown> | null = null,
) {
  const cachePatch: Record<string, unknown> = {};
  const has = (key: keyof typeof normalizedPatch) => Object.prototype.hasOwnProperty.call(normalizedPatch, key);
  if (channel === "gmb") {
    if (normalizedPatch.accountConnected === false) cachePatch.gmbAccountEmail = "";
    if (typeof normalizedPatch.connected === "boolean") cachePatch.gmbConnected = normalizedPatch.connected;
    if (typeof normalizedPatch.accountConnected === "boolean") cachePatch.gmbAccountConnected = normalizedPatch.accountConnected;
    if (typeof normalizedPatch.configured === "boolean") cachePatch.gmbConfigured = normalizedPatch.configured;
    if (isConnectionStatus(normalizedPatch.connectionStatus)) cachePatch.gmbConnectionStatus = normalizedPatch.connectionStatus;
    if (has("resourceId")) cachePatch.gmbLocationName = String(normalizedPatch.resourceId || "");
    if (has("resourceLabel")) cachePatch.gmbLocationLabel = String(normalizedPatch.resourceLabel || "");
    if (has("resourceUrl")) cachePatch.gmbUrl = String(normalizedPatch.resourceUrl || "");
  } else if (channel === "facebook") {
    if (normalizedPatch.accountConnected === false) cachePatch.facebookAccountEmail = "";
    if (typeof normalizedPatch.connected === "boolean") cachePatch.facebookPageConnected = normalizedPatch.connected;
    if (typeof normalizedPatch.accountConnected === "boolean") cachePatch.facebookAccountConnected = normalizedPatch.accountConnected;
    if (isConnectionStatus(normalizedPatch.connectionStatus)) cachePatch.facebookConnectionStatus = normalizedPatch.connectionStatus;
    if (has("resourceId")) cachePatch.fbSelectedPageId = String(normalizedPatch.resourceId || "");
    if (has("resourceLabel")) cachePatch.fbSelectedPageName = String(normalizedPatch.resourceLabel || "");
    if (has("resourceUrl")) cachePatch.facebookUrl = String(normalizedPatch.resourceUrl || "");
  } else if (channel === "instagram") {
    if (typeof normalizedPatch.connected === "boolean") cachePatch.instagramConnected = normalizedPatch.connected;
    if (typeof normalizedPatch.accountConnected === "boolean") cachePatch.instagramAccountConnected = normalizedPatch.accountConnected;
    if (isConnectionStatus(normalizedPatch.connectionStatus)) cachePatch.instagramConnectionStatus = normalizedPatch.connectionStatus;
    if (has("resourceLabel")) cachePatch.instagramUsername = String(normalizedPatch.resourceLabel || "");
    if (has("resourceUrl")) cachePatch.instagramUrl = String(normalizedPatch.resourceUrl || "");
  } else if (channel === "linkedin") {
    if (typeof normalizedPatch.connected === "boolean") cachePatch.linkedinConnected = normalizedPatch.connected;
    if (typeof normalizedPatch.accountConnected === "boolean") cachePatch.linkedinAccountConnected = normalizedPatch.accountConnected;
    if (isConnectionStatus(normalizedPatch.connectionStatus)) cachePatch.linkedinConnectionStatus = normalizedPatch.connectionStatus;
    if (has("resourceLabel")) cachePatch.linkedinDisplayName = String(normalizedPatch.resourceLabel || "");
    if (has("resourceUrl")) cachePatch.linkedinUrl = String(normalizedPatch.resourceUrl || "");

    if (normalizedPatch.accountConnected === false) {
      cachePatch.linkedinSelectedOrganizationId = "";
      cachePatch.linkedinSelectedOrganizationName = "";
      cachePatch.linkedinProfileUrl = "";
      cachePatch.linkedinOrganizationUrl = "";
      cachePatch.linkedinShareToPersonalProfile = false;
    } else if (has("resourceId")) {
      cachePatch.linkedinSelectedOrganizationId = String(normalizedPatch.resourceId || "");
      cachePatch.linkedinSelectedOrganizationName = normalizedPatch.resourceId ? String(normalizedPatch.resourceLabel || "") : "";
      cachePatch.linkedinOrganizationUrl = normalizedPatch.resourceId ? String(normalizedPatch.resourceUrl || "") : "";
      if (!normalizedPatch.resourceId && has("resourceUrl")) cachePatch.linkedinProfileUrl = String(normalizedPatch.resourceUrl || "");
    }
  } else if (channel === "tiktok") {
    if (typeof normalizedPatch.connected === "boolean") cachePatch.tiktokConnected = normalizedPatch.connected;
    cachePatch.tiktokRequiresUpdate = requiresUpdate;
    if (has("resourceLabel")) cachePatch.tiktokUsername = String(normalizedPatch.resourceLabel || "");
    if (has("resourceUrl")) cachePatch.tiktokProfileUrl = String(normalizedPatch.resourceUrl || "");
  } else if (channel === "youtube_shorts") {
    if (typeof normalizedPatch.connected === "boolean") cachePatch.youtubeShortsConnected = normalizedPatch.connected;
    cachePatch.youtubeShortsRequiresUpdate = requiresUpdate;
    if (has("resourceUrl")) cachePatch.youtubeShortsUrl = String(normalizedPatch.resourceUrl || "");
  } else if (channel === "pinterest") {
    if (typeof normalizedPatch.connected === "boolean") cachePatch.pinterestConnected = normalizedPatch.connected;
    cachePatch.pinterestRequiresUpdate = requiresUpdate;
    if (has("resourceUrl")) cachePatch.pinterestUrl = String(normalizedPatch.resourceUrl || "");
  }
  if (channel === "x") {
    if (typeof normalizedPatch.connected === "boolean") cachePatch.xConnected = normalizedPatch.connected;
    cachePatch.xRequiresUpdate = requiresUpdate;
    if (isConnectionStatus(normalizedPatch.connectionStatus)) cachePatch.xConnectionStatus = normalizedPatch.connectionStatus;
    if (has("resourceLabel")) cachePatch.xUsername = String(normalizedPatch.resourceLabel || "");
    if (has("resourceUrl")) cachePatch.xProfileUrl = String(normalizedPatch.resourceUrl || "");
  }
  if (channel === "threads") {
    if (typeof normalizedPatch.connected === "boolean") cachePatch.threadsConnected = normalizedPatch.connected;
    if (typeof normalizedPatch.accountConnected === "boolean") cachePatch.threadsAccountConnected = normalizedPatch.accountConnected;
    cachePatch.threadsRequiresUpdate = requiresUpdate;
    if (isConnectionStatus(normalizedPatch.connectionStatus)) cachePatch.threadsConnectionStatus = normalizedPatch.connectionStatus;
    if (has("resourceLabel")) cachePatch.threadsUsername = String(normalizedPatch.resourceLabel || "");
    if (has("resourceUrl")) cachePatch.threadsUrl = String(normalizedPatch.resourceUrl || "");
  }
  if (channel === "site_web") {
    // These controllers persist their per-service details before the patch.
    const cached = cachedSiteState ?? {};
    const prefix = "siteWeb";
    for (const key of Object.keys(cached)) if (key.startsWith(prefix)) cachePatch[key] = cached[key];
  }
  return cachePatch;
}

export function projectDashboardConnectionBlock(
  current: InrstatsChannelBlock,
  normalizedPatch: Partial<InrstatsChannelBlock["connection"]>,
  options: { clearData?: boolean; clearError?: boolean } | undefined,
  syncAt: number,
  snapshotDate: string,
): InrstatsChannelBlock {
  return {
    ...current,
    connection: {
      ...current.connection,
      ...normalizedPatch,
    },
    overview: options?.clearData ? null : current.overview,
    opportunities: options?.clearData ? 0 : current.opportunities,
    capturedLeads: options?.clearData ? { week: 0, month: 0 } : current.capturedLeads,
    estimatedValue: options?.clearData ? 0 : current.estimatedValue,
    live: options?.clearData ? false : current.live,
    error: options?.clearError === false ? current.error : null,
    syncAt,
    snapshotDate,
  };
}
