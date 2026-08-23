import { asRecord, asString } from "@/lib/tsSafe";
import { getConnectionDisplayStatus, mailConnectionKind, type ConnectionDisplayStatus } from "@/lib/connectionVersions";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hasActiveInrcySite } from "@/lib/inrcySite";
import { normalizeTiktokSettings } from "@/lib/tiktokSettings";
import { buildTiktokProfileUrl } from "@/lib/tiktokOAuth";
import { applyYoutubeShortsIntegrationState } from "@/lib/youtubeShortsOAuth";
import { hasUsableRefreshCredential } from "@/lib/publicationChannelAvailability";
import { getPinterestApiEnvironment } from "@/lib/pinterestOAuth";
import { log } from "@/lib/observability/logger";
import { isGoogleStatsSiteBindingConnected } from "@/lib/googleStatsConnectionPolicy";

type JsonRecord = Record<string, unknown>;

type IntegrationLite = {
  provider?: string | null;
  source?: string | null;
  product?: string | null;
  category?: string | null;
  account_email?: string | null;
  settings?: unknown;
  status?: string | null;
  resource_id?: string | null;
  resource_label?: string | null;
  display_name?: string | null;
  email_address?: string | null;
  expires_at?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  meta?: unknown;
  updated_at?: string | null;
  created_at?: string | null;
};

export type ChannelStates = {
  site_inrcy: {
    connected: boolean;
    expired: false;
    requiresUpdate: false;
    connection_status: ConnectionDisplayStatus;
    statsConnected: boolean;
    score: number;
    url: string | null;
    ga4: boolean;
    gsc: boolean;
  };
  site_web: {
    connected: boolean;
    expired: false;
    requiresUpdate: false;
    connection_status: ConnectionDisplayStatus;
    statsConnected: boolean;
    score: number;
    url: string | null;
    ga4: boolean;
    gsc: boolean;
  };
  gmb: {
    accountConnected: boolean;
    configured: boolean;
    connected: boolean;
    expired: boolean;
    requiresUpdate: boolean;
    connection_status: ConnectionDisplayStatus;
    account_name: string | null;
    resource_id: string | null;
    resource_label: string | null;
    email: string | null;
    url: string | null;
  };
  facebook: {
    accountConnected: boolean;
    pageConnected: boolean;
    connected: boolean;
    expired: boolean;
    requiresUpdate: boolean;
    connection_status: ConnectionDisplayStatus;
    resource_id: string | null;
    resource_label: string | null;
    user_email: string | null;
    page_url: string | null;
  };
  instagram: {
    accountConnected: boolean;
    connected: boolean;
    expired: boolean;
    requiresUpdate: boolean;
    connection_status: ConnectionDisplayStatus;
    resource_id: string | null;
    username: string | null;
    profile_url: string | null;
  };
  linkedin: {
    accountConnected: boolean;
    connected: boolean;
    expired: boolean;
    requiresUpdate: boolean;
    connection_status: ConnectionDisplayStatus;
    resource_id: string | null;
    display_name: string | null;
    profile_url: string | null;
    organization_id: string | null;
    organization_name: string | null;
    organization_url: string | null;
  };
  mails: {
    accountConnected: boolean;
    connected: boolean;
    connectedCount: number;
    maxAccounts: number;
    requiresUpdate: boolean;
    connection_status: ConnectionDisplayStatus;
  };
  tiktok: {
    accountConnected: boolean;
    connected: boolean;
    expired: boolean;
    requiresUpdate: boolean;
    connection_status: ConnectionDisplayStatus;
    resource_id: string | null;
    username: string | null;
    profile_url: string | null;
  };
  youtube_shorts: {
    accountConnected: boolean;
    connected: boolean;
    expired: boolean;
    requiresUpdate: boolean;
    connection_status: ConnectionDisplayStatus;
    resource_id: string | null;
    channel_name: string | null;
    channel_url: string | null;
  };
  pinterest: {
    accountConnected: boolean;
    connected: boolean;
    expired: boolean;
    requiresUpdate: boolean;
    connection_status: ConnectionDisplayStatus;
    resource_id: string | null;
    username: string | null;
    profile_url: string | null;
    default_board_id: string | null;
    default_board_name: string | null;
  };
  inr_search: {
    accountConnected: boolean;
    connected: boolean;
    expired: boolean;
    requiresUpdate: boolean;
    connection_status: ConnectionDisplayStatus;
    business_unit_id: string | null;
    business_name: string | null;
    profile_url: string | null;
    review_invite_url: string | null;
  };
};

function isExpired(expiresAt: unknown, skewSeconds = 60) {
  const iso = asString(expiresAt);
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now() + skewSeconds * 1000;
}

function latestIntegration(rows: IntegrationLite[], provider: string, source: string, product: string): JsonRecord {
  const filtered = rows.filter((row) => row.provider === provider && row.source === source && row.product === product);
  filtered.sort((a, b) => {
    const at = new Date(String(a.updated_at || a.created_at || 0)).getTime();
    const bt = new Date(String(b.updated_at || b.created_at || 0)).getTime();
    return bt - at;
  });
  return asRecord(filtered[0]);
}

function hasTruthyString(v: unknown) {
  return !!(asString(v) || "").trim();
}

function hasIntegrationRecord(row: JsonRecord) {
  return Object.keys(row).length > 0;
}

function buildGoogleMapsSearchUrl(label: string | null) {
  const clean = (label || "").trim();
  return clean ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean)}` : null;
}

function buildFacebookPageUrl(resourceId: string | null) {
  const clean = (resourceId || "").trim();
  return clean ? `https://www.facebook.com/${encodeURIComponent(clean)}` : null;
}

function hasGoogleSetting(settingsNode: unknown, product: "ga4" | "gsc") {
  const node = asRecord(settingsNode);
  if (product === "ga4") return hasTruthyString(asRecord(node.ga4).property_id) || hasTruthyString(asRecord(node.ga4).measurement_id);
  return hasTruthyString(asRecord(node.gsc).property);
}

function isConnectedGoogleStat(rows: IntegrationLite[], source: "site_inrcy" | "site_web", product: "ga4" | "gsc", fallbackSettingsNode?: unknown) {
  const settingsConnected = hasGoogleSetting(fallbackSettingsNode, product);
  const row = latestIntegration(rows, "google", source, product);

  return isGoogleStatsSiteBindingConnected({
    row,
    settingsConnected,
  });
}

export async function getChannelConnectionStates(
  supabase: any,
  userId: string,
  preload?: {
    profile?: unknown;
    inrcySiteConfig?: unknown;
    proToolsConfig?: unknown;
    integrations?: unknown[];
  }
): Promise<ChannelStates> {
  const usePreload = Boolean(preload);
  const [profileRes, inrcyCfgRes, proCfgRes, integrationsRes] = usePreload
    ? await Promise.all([
        Promise.resolve({ data: preload?.profile ?? null }),
        Promise.resolve({ data: preload?.inrcySiteConfig ?? null }),
        Promise.resolve({ data: preload?.proToolsConfig ?? null }),
        Promise.resolve({ data: preload?.integrations ?? [] }),
      ])
    : await Promise.all([
        supabase.from("profiles").select("inrcy_site_ownership").eq("user_id", userId).maybeSingle(),
        supabase.from("inrcy_site_configs").select("site_url,settings").eq("user_id", userId).maybeSingle(),
        supabase.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle(),
        supabaseAdmin
          .from("integrations")
          .select("provider,source,product,category,account_email,settings,status,resource_id,resource_label,display_name,email_address,expires_at,access_token_enc,refresh_token_enc,meta,updated_at,created_at")
          .eq("user_id", userId),
      ]);

  if (!usePreload) {
    const failedSources = [
      ["profiles", (profileRes as { error?: unknown }).error],
      ["inrcy_site_configs", (inrcyCfgRes as { error?: unknown }).error],
      ["pro_tools_configs", (proCfgRes as { error?: unknown }).error],
      ["integrations", (integrationsRes as { error?: unknown }).error],
    ].filter((entry) => Boolean(entry[1])).map((entry) => String(entry[0]));

    if (failedSources.length > 0) {
      log.error("channel_connection_state_read_failed", {
        user_id: userId,
        failed_sources: failedSources,
      });
      throw new Error("Impossible de synchroniser l'état des canaux.");
    }
  }

  const profile = asRecord((profileRes as { data?: unknown }).data);
  const inrcyCfg = asRecord((inrcyCfgRes as { data?: unknown }).data);
  const inrcyCfgSettings = asRecord(inrcyCfg.settings);
  const proCfg = asRecord((proCfgRes as { data?: unknown }).data);
  const settings = asRecord(proCfg.settings);
  const pinterestSettings = asRecord(settings.pinterest);
  const rowsRaw = (integrationsRes as { data?: unknown }).data;
  const rows = Array.isArray(rowsRaw) ? (rowsRaw as IntegrationLite[]) : [];

  const ownership = asString(profile.inrcy_site_ownership) || "none";
  const inrcyHasSite = hasActiveInrcySite(ownership);
  const inrcyUrl = (asString(inrcyCfg?.site_url) || "").trim();
  const siteWeb = asRecord(settings.site_web);
  const siteWebUrl = (asString(siteWeb.url) || "").trim();

  const inrcyGa4Binding = isConnectedGoogleStat(rows, "site_inrcy", "ga4", inrcyCfgSettings);
  const inrcyGscBinding = isConnectedGoogleStat(rows, "site_inrcy", "gsc", inrcyCfgSettings);
  const webGa4Binding = isConnectedGoogleStat(rows, "site_web", "ga4", siteWeb);
  const webGscBinding = isConnectedGoogleStat(rows, "site_web", "gsc", siteWeb);

  // A Google binding belongs to a site. Do not let an orphaned GA4/GSC
  // setting make Dashboard or iNrStats report a connection without that site.
  const inrcyGa4 = Boolean(inrcyHasSite && inrcyUrl && inrcyGa4Binding);
  const inrcyGsc = Boolean(inrcyHasSite && inrcyUrl && inrcyGscBinding);
  const webGa4 = Boolean(siteWebUrl && webGa4Binding);
  const webGsc = Boolean(siteWebUrl && webGscBinding);
  const inrcyStatsConnected = inrcyGa4 || inrcyGsc;
  const webStatsConnected = webGa4 || webGsc;
  const inrcyScore = (inrcyHasSite && !!inrcyUrl ? 1 : 0) + (inrcyGa4 ? 1 : 0) + (inrcyGsc ? 1 : 0);
  const webScore = (!!siteWebUrl ? 1 : 0) + (webGa4 ? 1 : 0) + (webGsc ? 1 : 0);

  const fb = latestIntegration(rows, "facebook", "facebook", "facebook");
  const fbSettings = asRecord(settings.facebook);
  const fbMeta = asRecord(fb.meta);
  const fbHasSelectedPageToken = hasTruthyString(fbMeta.selected) || hasTruthyString(fb.resource_id);
  const fbExpired = isExpired(fb.expires_at) && !fbHasSelectedPageToken;
  const fbStatus = asString(fb.status);
  const fbHasOfficialRow = hasIntegrationRecord(fb);
  const fbHasToken = hasTruthyString(fb.access_token_enc) || hasTruthyString(fbMeta.standard_user_access_token_enc) || hasTruthyString(fbMeta.business_user_access_token_enc) || hasTruthyString(fbMeta.user_access_token_enc);
  // OAuth integrations are the only publication authority. pro_tools_configs
  // is a display mirror and must never turn a channel green on its own.
  const fbAccountConnected = Boolean(
    fbHasOfficialRow &&
      (fbStatus === "account_connected" || fbStatus === "connected") &&
      !fbExpired &&
      fbHasToken,
  );
  const fbResourceId = asString(fb.resource_id) || asString(fbSettings.pageId) || null;
  const fbResourceLabel = asString(fb.resource_label) || asString(fbSettings.pageName) || null;
  const fbPageUrl = asString(asRecord(fb.meta).page_url) || asString(fbSettings.url) || buildFacebookPageUrl(fbResourceId);
  const fbPageConnected = Boolean(fbAccountConnected && fbResourceId);
  const fbConnectionStatus = fbExpired
    ? "needs_update"
    : getConnectionDisplayStatus(fbPageConnected, "channel:facebook", fbMeta);
  const fbRequiresUpdate = fbConnectionStatus === "needs_update";

  const ig = latestIntegration(rows, "instagram", "instagram", "instagram");
  const igSettings = asRecord(settings.instagram);
  const igMeta = asRecord(ig.meta);
  const igHasSelectedProfileToken = hasTruthyString(igMeta.page_id) || hasTruthyString(ig.resource_id);
  const igExpired = isExpired(ig.expires_at) && !igHasSelectedProfileToken;
  const igStatus = asString(ig.status);
  const igHasOfficialRow = hasIntegrationRecord(ig);
  const igHasToken = hasTruthyString(ig.access_token_enc);
  const igAccountConnected = Boolean(
    igHasOfficialRow &&
      (igStatus === "account_connected" || igStatus === "connected") &&
      !igExpired &&
      igHasToken,
  );
  const igResourceId = asString(ig.resource_id) || asString(igSettings.igId) || asString(igSettings.pageId) || null;
  const igUsername = asString(ig.resource_label) || asString(igSettings.username) || null;
  const igProfileUrl = asString(igSettings.url) || (igUsername ? `https://www.instagram.com/${igUsername}/` : null);
  const igConnected = Boolean(igAccountConnected && igResourceId);
  const igConnectionStatus = igExpired
    ? "needs_update"
    : getConnectionDisplayStatus(igConnected, "channel:instagram", igMeta);
  const igRequiresUpdate = igConnectionStatus === "needs_update";

  const li = latestIntegration(rows, "linkedin", "linkedin", "linkedin");
  const liSettings = asRecord(settings.linkedin);
  const liHasToken = hasTruthyString(li.access_token_enc);
  const liHasRefreshToken = hasTruthyString(li.refresh_token_enc);
  const liMeta = asRecord(li.meta);
  const liHasUsableRefreshToken = hasUsableRefreshCredential(
    liHasRefreshToken,
    liMeta.refresh_expires_at,
  );
  const liHasReusableAuth = liHasToken || liHasUsableRefreshToken;
  const liExpired = isExpired(li.expires_at) && !liHasUsableRefreshToken;
  const liStatus = asString(li.status);
  const liHasOfficialRow = hasIntegrationRecord(li);
  const liHasPublicationTarget = Boolean(
    asString(li.resource_id) ||
      asString(liMeta.profile_urn) ||
      asString(liMeta.org_urn) ||
      asString(liMeta.org_id),
  );
  const liConnected = Boolean(
    liHasOfficialRow && (liStatus === "connected" || liStatus === "account_connected") && liHasReusableAuth && liHasPublicationTarget && !liExpired,
  );
  const liConnectionStatus = liExpired
    ? "needs_update"
    : getConnectionDisplayStatus(liConnected, "channel:linkedin", liMeta);
  const liRequiresUpdate = liConnectionStatus === "needs_update";
  const liActiveOrganizationId = asString(liMeta.org_id) || asString(liSettings.orgId) || "";
  const liProfileUrl = asString(liMeta.profile_url) || asString(liMeta.profile) || asString(liSettings.profileUrl) || (!liActiveOrganizationId ? asString(liSettings.url) : "") || null;
  const liOrganizationUrl = asString(liMeta.org_url) || asString(liSettings.orgUrl) || (liActiveOrganizationId ? asString(liSettings.url) : "") || null;

  const tk = latestIntegration(rows, "tiktok", "tiktok", "tiktok");
  const tiktokSettings = normalizeTiktokSettings(settings.tiktok);
  const tkHasToken = hasTruthyString(tk.access_token_enc);
  const tkHasRefreshToken = hasTruthyString(tk.refresh_token_enc);
  const tkMeta = asRecord(tk.meta);
  const tkHasUsableRefreshToken = hasUsableRefreshCredential(
    tkHasRefreshToken,
    tkMeta.refresh_expires_at,
  );
  const tkHasReusableAuth = tkHasToken || tkHasUsableRefreshToken;
  const tkExpired = isExpired(tk.expires_at) && !tkHasUsableRefreshToken;
  const tkStatus = asString(tk.status);
  // TikTok est connecté uniquement si une intégration OAuth réelle est active.
  // Les anciens réglages/mock ou un simple lien public ne doivent jamais rendre la bulle verte.
  const tiktokConnected = Boolean((tkStatus === "connected" || tkStatus === "account_connected") && tkHasReusableAuth && !tkExpired);
  const tiktokNeedsReconnect = Boolean(
    tkMeta["needs_reconnect"] === true ||
      tkMeta["tiktok_needs_reconnect"] === true ||
      asString(tkMeta["tiktok_stats_needs_reconnect_at"]) ||
      asString(tkMeta["tiktok_token_invalid_at"]),
  );
  const tiktokConnectionStatus = tkExpired
    ? "needs_update"
    : tiktokNeedsReconnect && tiktokConnected
      ? "needs_update"
      : getConnectionDisplayStatus(tiktokConnected, "channel:tiktok", tkMeta);
  const tiktokRequiresUpdate = tiktokConnectionStatus === "needs_update";
  const tiktokUsername = tiktokConnected ? (asString(tkMeta.username) || asString(tk.resource_label) || tiktokSettings.username || null) : null;
  const tiktokProfileUrl = tiktokConnected ? (asString(tkMeta.profile_url) || tiktokSettings.profileUrl || buildTiktokProfileUrl(tiktokUsername) || null) : null;

  const yt = latestIntegration(rows, "youtube", "youtube_shorts", "youtube_shorts");
  const ytMeta = asRecord(yt.meta);
  const youtubeShorts = applyYoutubeShortsIntegrationState(settings.youtube_shorts, yt);
  const youtubeShortsHasRefreshToken = hasTruthyString(yt.refresh_token_enc);
  const youtubeShortsExpired = isExpired(yt.expires_at) && !youtubeShortsHasRefreshToken;
  const youtubeShortsConnectionStatus = youtubeShortsExpired
    ? "needs_update"
    : getConnectionDisplayStatus(youtubeShorts.connected, "channel:youtube_shorts", ytMeta);
  const youtubeShortsRequiresUpdate = youtubeShortsConnectionStatus === "needs_update";

  const mailRows = rows.filter((row) => row.category === "mail");
  const connectedMailRows = mailRows.filter((row) => {
    const status = (asString(row.status) || "").toLowerCase();
    const isConnected = status === "connected";
    const kind = mailConnectionKind(row.provider);
    const connectionStatus = kind
      ? getConnectionDisplayStatus(isConnected, kind, asRecord(row.settings))
      : isConnected
        ? "connected"
        : "disconnected";
    return isConnected && connectionStatus !== "needs_update";
  });
  const mailConnectedCount = Math.max(0, Math.min(4, connectedMailRows.length));
  const mailsConnected = mailConnectedCount > 0;
  const mailsRequireUpdate = !mailsConnected && mailRows.some((row) => {
    const status = (asString(row.status) || "").toLowerCase();
    const kind = mailConnectionKind(row.provider);
    return Boolean(
      status === "connected" &&
        kind &&
        getConnectionDisplayStatus(true, kind, asRecord(row.settings)) === "needs_update",
    );
  });

  const pinterest = latestIntegration(rows, "pinterest", "pinterest", "pinterest");
  const pinterestHasAccessToken = hasTruthyString(pinterest.access_token_enc);
  const pinterestHasRefreshToken = hasTruthyString(pinterest.refresh_token_enc);
  const pinterestMeta = asRecord(pinterest.meta);
  const pinterestHasUsableRefreshToken = hasUsableRefreshCredential(
    pinterestHasRefreshToken,
    pinterestMeta.refresh_expires_at,
  );
  const pinterestHasToken = pinterestHasAccessToken || pinterestHasUsableRefreshToken;
  const pinterestExpired = isExpired(pinterest.expires_at) && !pinterestHasUsableRefreshToken;
  const pinterestStatus = asString(pinterest.status);
  const pinterestStoredEnvironment =
    asString(pinterestMeta.pinterest_api_environment) || "production";
  const pinterestEnvironmentMismatch = Boolean(
    hasIntegrationRecord(pinterest) &&
      pinterestStoredEnvironment !== getPinterestApiEnvironment(),
  );
  const pinterestOAuthConnected = Boolean((pinterestStatus === "connected" || pinterestStatus === "account_connected") && pinterestHasToken && !pinterestExpired);
  const pinterestConnected = pinterestOAuthConnected && !pinterestEnvironmentMismatch;
  const pinterestConnectionStatus = pinterestExpired || pinterestEnvironmentMismatch
    ? "needs_update"
    : getConnectionDisplayStatus(pinterestConnected, "channel:pinterest", pinterestMeta);
  const pinterestRequiresUpdate = pinterestConnectionStatus === "needs_update";
  const pinterestDefaultBoardId = asString(pinterestSettings.defaultBoardId) || null;
  const pinterestDefaultBoardName = asString(pinterestSettings.defaultBoardName) || null;

  // iNr'Search est une page publique gérée par iNrCy, pas une connexion OAuth tierce.
  const inrSearchSettings = asRecord(settings.inrSearch);
  const inrSearchSlug = asString(inrSearchSettings.slug);
  const inrSearchEnabled = Boolean(inrSearchSettings.enabled && inrSearchSlug);
  const inrSearchOrigin = ((process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, "") === "https://inrcy.com" ? "https://app.inrcy.com" : (process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, ""));
  const inrSearchProfileUrl = inrSearchEnabled ? `${inrSearchOrigin}/entreprises/${inrSearchSlug}` : null;
  const inrSearchBusinessName = asString(inrSearchSettings.pageTitle) || null;

  const gmb = latestIntegration(rows, "google", "gmb", "gmb");
  const gmbSettings = asRecord(settings.gmb);
  const gmbMeta = asRecord(gmb.meta);
  const gmbStatus = asString(gmb.status);
  const gmbHasOfficialRow = hasIntegrationRecord(gmb);
  const gmbHasToken = hasTruthyString(gmb.access_token_enc);
  const gmbHasRefreshToken = hasTruthyString(gmb.refresh_token_enc);
  const gmbHasReusableAuth = gmbHasToken || gmbHasRefreshToken;
  const gmbExpired = isExpired(gmb.expires_at) && !gmbHasRefreshToken;
  const gmbAccountConnected = Boolean(
    gmbHasOfficialRow &&
      (gmbStatus === "connected" || gmbStatus === "account_connected") &&
      gmbHasReusableAuth &&
      !gmbExpired,
  );
  const gmbResourceId = asString(gmb.resource_id) || asString(gmbSettings.locationName) || null;
  const gmbResourceLabel = asString(gmb.resource_label) || asString(gmbSettings.locationTitle) || null;
  const gmbAccountName = asString(gmbMeta.account) || asString(gmbSettings.accountName) || null;
  const gmbUrl = asString(gmbMeta.url) || asString(gmbSettings.url) || buildGoogleMapsSearchUrl(gmbResourceLabel || gmbResourceId);
  const gmbConfigured = Boolean(gmbAccountConnected && gmbResourceId && gmbAccountName);
  const gmbConnectionStatus = gmbExpired
    ? "needs_update"
    : getConnectionDisplayStatus(gmbConfigured, "channel:gmb", gmbMeta);
  const gmbRequiresUpdate = gmbConnectionStatus === "needs_update";

  return {
    site_inrcy: {
      connected: inrcyHasSite && !!inrcyUrl,
      expired: false,
      requiresUpdate: false,
      connection_status: inrcyHasSite && !!inrcyUrl ? "connected" : "disconnected",
      statsConnected: inrcyStatsConnected,
      score: inrcyScore,
      url: inrcyUrl || null,
      ga4: inrcyGa4,
      gsc: inrcyGsc,
    },
    site_web: {
      connected: !!siteWebUrl,
      expired: false,
      requiresUpdate: false,
      connection_status: siteWebUrl ? "connected" : "disconnected",
      statsConnected: webStatsConnected,
      score: webScore,
      url: siteWebUrl || null,
      ga4: webGa4,
      gsc: webGsc,
    },
    gmb: {
      accountConnected: gmbAccountConnected,
      configured: gmbConfigured,
      connected: gmbConfigured,
      expired: gmbExpired,
      requiresUpdate: gmbRequiresUpdate,
      connection_status: gmbConnectionStatus,
      account_name: gmbAccountName,
      resource_id: gmbResourceId,
      resource_label: gmbResourceLabel,
      email: asString(gmb.email_address) || asString(gmbSettings.accountEmail) || null,
      url: gmbUrl,
    },
    facebook: {
      accountConnected: fbAccountConnected,
      pageConnected: fbPageConnected,
      connected: fbPageConnected,
      expired: fbExpired,
      requiresUpdate: fbRequiresUpdate,
      connection_status: fbConnectionStatus,
      resource_id: fbResourceId,
      resource_label: fbResourceLabel,
      user_email: asString(fb.email_address) || asString(fbSettings.userEmail) || null,
      page_url: fbPageUrl,
    },
    instagram: {
      accountConnected: igAccountConnected,
      connected: igConnected,
      expired: igExpired,
      requiresUpdate: igRequiresUpdate,
      connection_status: igConnectionStatus,
      resource_id: igResourceId,
      username: igUsername,
      profile_url: igProfileUrl,
    },
    linkedin: {
      accountConnected: liConnected,
      connected: liConnected,
      expired: liExpired,
      requiresUpdate: liRequiresUpdate,
      connection_status: liConnectionStatus,
      resource_id: asString(li.resource_id) || null,
      display_name: asString(liMeta.profile_display_name) || asString(li.display_name) || asString(liSettings.displayName) || asString(li.resource_label) || null,
      profile_url: liProfileUrl,
      organization_id: asString(liMeta.org_id) || asString(liSettings.orgId) || null,
      organization_name: asString(liMeta.org_name) || asString(liSettings.orgName) || null,
      organization_url: liOrganizationUrl,
    },
    mails: {
      accountConnected: mailsConnected,
      connected: mailsConnected,
      connectedCount: mailConnectedCount,
      maxAccounts: 4,
      requiresUpdate: mailsRequireUpdate,
      connection_status: mailsConnected ? "connected" : mailsRequireUpdate ? "needs_update" : "disconnected",
    },
    tiktok: {
      accountConnected: tiktokConnected,
      connected: tiktokConnected,
      expired: tkExpired,
      requiresUpdate: tiktokRequiresUpdate,
      connection_status: tiktokConnectionStatus,
      resource_id: tiktokConnected ? (asString(tk.resource_id) || tiktokUsername) : null,
      username: tiktokConnected ? tiktokUsername : null,
      profile_url: tiktokConnected ? tiktokProfileUrl : null,
    },
    youtube_shorts: {
      accountConnected: youtubeShorts.connected,
      connected: youtubeShorts.connected,
      expired: youtubeShortsExpired,
      requiresUpdate: youtubeShortsRequiresUpdate,
      connection_status: youtubeShortsConnectionStatus,
      resource_id: youtubeShorts.connected ? (youtubeShorts.channelId || youtubeShorts.channelHandle || youtubeShorts.channelUrl || null) : null,
      channel_name: youtubeShorts.connected ? (youtubeShorts.channelName || youtubeShorts.channelHandle || youtubeShorts.channelUrl || null) : null,
      channel_url: youtubeShorts.connected ? (youtubeShorts.channelUrl || null) : null,
    },
    pinterest: {
      accountConnected: pinterestConnected,
      connected: pinterestConnected,
      expired: pinterestExpired,
      requiresUpdate: pinterestRequiresUpdate,
      connection_status: pinterestConnectionStatus,
      // Le lien public est renseigné par le professionnel et reste indépendant des données API Pinterest.
      resource_id: pinterestDefaultBoardId,
      username: null,
      profile_url: asString(pinterestSettings.publicProfileUrl) || null,
      default_board_id: pinterestDefaultBoardId,
      default_board_name: pinterestDefaultBoardName,
    },
    inr_search: {
      accountConnected: inrSearchEnabled,
      connected: inrSearchEnabled,
      expired: false,
      requiresUpdate: false,
      connection_status: inrSearchEnabled ? "connected" : "disconnected",
      business_unit_id: null,
      business_name: inrSearchBusinessName,
      profile_url: inrSearchProfileUrl,
      review_invite_url: null,
    },
  };
}
