import {
  expectedUiSnapshotDate,
  fmtInt,
  readUiCacheValue,
  safeNum,
  writeUiCacheValue,
  type CapturedLeads,
  type CubeKey,
  type CubeModel,
  type Period,
  type StatsTranslator,
} from "./stats.shared";

export function normalizeCapturedLeads(raw: unknown, fallback?: CapturedLeads): CapturedLeads {
  const value = raw && typeof raw === "object" ? raw as Partial<CapturedLeads> : {};
  return {
    week: Math.max(0, Math.round(safeNum(value.week, fallback?.week ?? 0))),
    month: Math.max(0, Math.round(safeNum(value.month, fallback?.month ?? 0))),
  };
}

export type MailStatsSnapshot = {
  loading: boolean;
  error?: string;
  syncedAt?: number;
  connectedCount: number;
  maxAccounts: number;
  campagnes30: number;
  campagnesTotal: number;
  destinataires30: number;
  contactsCrm: number;
  contactsEmail: number;
  propulsions30: number;
  fidelisations30: number;
  mailsSimples30: number;
  agendaReminders30: number;
  agendaRemindersTotal: number;
  factures30: number;
  facturesTotal: number;
  devis30: number;
  devisTotal: number;
  destinatairesTotal: number;
  breakdown?: {
    fideliser?: { total?: number; informer?: number; suivre?: number; enqueter?: number };
    propulser?: { total?: number; valoriser?: number; recolter?: number; offrir?: number };
    mailsSimples?: number;
  };
};

export const EMPTY_MAIL_STATS: MailStatsSnapshot = {
  loading: true,
  connectedCount: 0,
  maxAccounts: 4,
  campagnes30: 0,
  campagnesTotal: 0,
  destinataires30: 0,
  contactsCrm: 0,
  contactsEmail: 0,
  propulsions30: 0,
  fidelisations30: 0,
  mailsSimples30: 0,
  agendaReminders30: 0,
  agendaRemindersTotal: 0,
  factures30: 0,
  facturesTotal: 0,
  devis30: 0,
  devisTotal: 0,
  destinatairesTotal: 0,
};

export type InrBadgePeriodStats = {
  week: number;
  month: number;
  total: number;
};

export type InrBadgeStatsSnapshot = {
  loading: boolean;
  error?: string;
  syncedAt?: number;
  views: InrBadgePeriodStats;
  qrScans: InrBadgePeriodStats;
  actions: InrBadgePeriodStats;
  leads: InrBadgePeriodStats;
  appointments: InrBadgePeriodStats;
  capturedLeads: CapturedLeads;
  actionsByKey: Record<string, InrBadgePeriodStats>;
  qualityScore: number;
  opportunity30: number;
};

export const ZERO_INRBADGE_PERIOD: InrBadgePeriodStats = { week: 0, month: 0, total: 0 };

export const EMPTY_INRBADGE_STATS: InrBadgeStatsSnapshot = {
  loading: true,
  views: ZERO_INRBADGE_PERIOD,
  qrScans: ZERO_INRBADGE_PERIOD,
  actions: ZERO_INRBADGE_PERIOD,
  leads: ZERO_INRBADGE_PERIOD,
  appointments: ZERO_INRBADGE_PERIOD,
  capturedLeads: { week: 0, month: 0 },
  actionsByKey: {},
  qualityScore: 52,
  opportunity30: 4,
};

export function normalizeInrBadgePeriodStats(value: unknown): InrBadgePeriodStats {
  const raw = value && typeof value === "object" ? value as Partial<InrBadgePeriodStats> : {};
  return {
    week: Math.max(0, Math.round(safeNum(raw.week))),
    month: Math.max(0, Math.round(safeNum(raw.month))),
    total: Math.max(0, Math.round(safeNum(raw.total, safeNum(raw.month)))),
  };
}

export function normalizeInrBadgeStatsSnapshot(value: unknown, syncedAt?: number): InrBadgeStatsSnapshot {
  const raw = value && typeof value === "object" ? value as Partial<InrBadgeStatsSnapshot> : {};
  const actionsByKeyRaw = raw.actionsByKey && typeof raw.actionsByKey === "object" ? raw.actionsByKey as Record<string, unknown> : {};
  const actionsByKey = Object.fromEntries(
    Object.entries(actionsByKeyRaw).map(([key, stats]) => [key, normalizeInrBadgePeriodStats(stats)])
  ) as Record<string, InrBadgePeriodStats>;

  return {
    loading: false,
    error: typeof raw.error === "string" ? raw.error : undefined,
    syncedAt: Number.isFinite(Number(syncedAt ?? raw.syncedAt)) ? Number(syncedAt ?? raw.syncedAt) : Date.now(),
    views: normalizeInrBadgePeriodStats(raw.views),
    qrScans: normalizeInrBadgePeriodStats(raw.qrScans),
    actions: normalizeInrBadgePeriodStats(raw.actions),
    leads: normalizeInrBadgePeriodStats(raw.leads),
    appointments: normalizeInrBadgePeriodStats(raw.appointments),
    capturedLeads: normalizeCapturedLeads(raw.capturedLeads),
    actionsByKey,
    qualityScore: Math.max(0, Math.min(100, Math.round(safeNum(raw.qualityScore, 52)))),
    opportunity30: Math.max(0, Math.round(safeNum(raw.opportunity30, 4))),
  };
}


export type InrSearchStatsSnapshot = {
  loading: boolean;
  error?: string;
  syncedAt?: number;
  enabled: boolean;
  slug: string;
  publicUrl: string;
  pageTitle: string;
  qualityScore: number;
  views: InrBadgePeriodStats;
  actions: InrBadgePeriodStats;
  contactActions: { week: number; month: number };
  actionsByKey: Record<string, number>;
  sources: Record<string, number>;
  topAction: { key: string; count: number } | null;
  topSource: { key: string; count: number } | null;
};

export const EMPTY_INR_SEARCH_STATS: InrSearchStatsSnapshot = {
  loading: true,
  enabled: false,
  slug: "",
  publicUrl: "",
  pageTitle: "",
  qualityScore: 0,
  views: ZERO_INRBADGE_PERIOD,
  actions: ZERO_INRBADGE_PERIOD,
  contactActions: { week: 0, month: 0 },
  actionsByKey: {},
  sources: {},
  topAction: null,
  topSource: null,
};

export function normalizeInrSearchStatsSnapshot(value: unknown): InrSearchStatsSnapshot {
  const raw = value && typeof value === "object" ? value as Record<string, any> : {};
  const analytics = raw.analytics && typeof raw.analytics === "object" ? raw.analytics as Record<string, any> : {};
  const page = raw.page && typeof raw.page === "object" ? raw.page as Record<string, any> : {};
  const contact = analytics.contactActions && typeof analytics.contactActions === "object" ? analytics.contactActions as Record<string, any> : {};
  const actionsByKeyRaw = analytics.actionsByKey && typeof analytics.actionsByKey === "object" ? analytics.actionsByKey as Record<string, unknown> : {};
  const sourcesRaw = analytics.sources && typeof analytics.sources === "object" ? analytics.sources as Record<string, unknown> : {};

  return {
    loading: false,
    error: typeof raw.error === "string" ? raw.error : undefined,
    syncedAt: Number.isFinite(Number(analytics.syncedAt)) ? Number(analytics.syncedAt) : Date.now(),
    enabled: Boolean(page.enabled),
    slug: String(page.slug || ""),
    publicUrl: String(page.publicUrl || ""),
    pageTitle: String(page.pageTitle || ""),
    qualityScore: Math.max(0, Math.min(100, Math.round(safeNum(page.qualityScore)))),
    views: normalizeInrBadgePeriodStats(analytics.views),
    actions: normalizeInrBadgePeriodStats(analytics.actions),
    contactActions: {
      week: Math.max(0, Math.round(safeNum(contact.week))),
      month: Math.max(0, Math.round(safeNum(contact.month))),
    },
    actionsByKey: Object.fromEntries(Object.entries(actionsByKeyRaw).map(([key, count]) => [key, Math.max(0, Math.round(safeNum(count)))])),
    sources: Object.fromEntries(Object.entries(sourcesRaw).map(([key, count]) => [key, Math.max(0, Math.round(safeNum(count)))])),
    topAction: analytics.topAction && typeof analytics.topAction === "object"
      ? { key: String(analytics.topAction.key || ""), count: Math.max(0, Math.round(safeNum(analytics.topAction.count))) }
      : null,
    topSource: analytics.topSource && typeof analytics.topSource === "object"
      ? { key: String(analytics.topSource.key || ""), count: Math.max(0, Math.round(safeNum(analytics.topSource.count))) }
      : null,
  };
}

const MAIL_STATS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DASHBOARD_CHANNEL_STATE_CACHE_KEY = "inrcy_dashboard_channel_state_v1";

export type ChannelIdentityHints = Partial<Record<CubeKey, string>>;
export type CachedChannelConnectivity = Partial<Record<CubeKey, boolean>>;
export type OfficialChannelConnectionStatus = "connected" | "needs_update" | "disconnected" | "unavailable";
export type OfficialChannelConnectionStatuses = Partial<Record<CubeKey, OfficialChannelConnectionStatus>>;

export const FAIL_CLOSED_STATS_CHANNEL_KEYS: readonly CubeKey[] = [
  "site_inrcy",
  "site_web",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "mails",
  "tiktok",
  "youtube_shorts",
  "pinterest",
];

export function unavailableOfficialChannelStatuses(): OfficialChannelConnectionStatuses {
  return Object.fromEntries(
    FAIL_CLOSED_STATS_CHANNEL_KEYS.map((key) => [key, "unavailable"]),
  ) as OfficialChannelConnectionStatuses;
}

export function unavailableOfficialChannelConnectivity(): CachedChannelConnectivity {
  return Object.fromEntries(
    FAIL_CLOSED_STATS_CHANNEL_KEYS.map((key) => [key, false]),
  ) as CachedChannelConnectivity;
}

export function cleanChannelIdentityHint(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readCachedDashboardChannelState(): Record<string, any> | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = readUiCacheValue(DASHBOARD_CHANNEL_STATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    const state = parsed?.state && typeof parsed.state === "object" ? parsed.state : parsed;
    if (!state || typeof state !== "object" || Array.isArray(state)) return null;
    return state;
  } catch {
    return null;
  }
}

export function readCachedDashboardChannelIdentityHints(): ChannelIdentityHints {
  try {
    const state = readCachedDashboardChannelState();
    if (!state) return {};

    const instagramUsername = cleanChannelIdentityHint(state.instagramUsername).replace(/^@+/, "");
    const hints: ChannelIdentityHints = {
      site_inrcy: cleanChannelIdentityHint(state.siteInrcySavedUrl || state.siteInrcyUrl),
      site_web: cleanChannelIdentityHint(state.siteWebSavedUrl || state.siteWebUrl),
      gmb: state.gmbConnected ? cleanChannelIdentityHint(state.gmbLocationLabel || state.gmbLocationName) : "",
      facebook: state.facebookPageConnected ? cleanChannelIdentityHint(state.fbSelectedPageName) : "",
      instagram: state.instagramConnected && instagramUsername ? `@${instagramUsername}` : "",
      linkedin: state.linkedinConnected ? cleanChannelIdentityHint(state.linkedinSelectedOrganizationName || state.linkedinDisplayName) : "",
      tiktok: state.tiktokConnected ? cleanChannelIdentityHint(state.tiktokUsername) : "",
      youtube_shorts: state.youtubeShortsConnected ? cleanChannelIdentityHint(state.youtubeShortsChannelName || state.youtubeShortsUrl) : "",
      pinterest: state.pinterestConnected ? cleanChannelIdentityHint(state.pinterestAccountName || state.pinterestUrl) : "",
    };

    return Object.fromEntries(
      Object.entries(hints).filter(([, value]) => Boolean(cleanChannelIdentityHint(value))),
    ) as ChannelIdentityHints;
  } catch {
    return {};
  }
}

export function readCachedDashboardChannelConnectivity(): CachedChannelConnectivity {
  try {
    const state = readCachedDashboardChannelState();
    if (!state) return {};

    return {
      inrbadge: typeof state.inrBadgeProfileReady === "boolean" ? state.inrBadgeProfileReady : undefined,
      inr_search: Boolean(state.inrSearchConnected),
      site_inrcy: Boolean(state.siteInrcyGa4Connected || state.siteInrcyGscConnected),
      site_web: Boolean(state.siteWebGa4Connected || state.siteWebGscConnected),
      gmb: Boolean(state.gmbConnected && state.gmbConnectionStatus !== "needs_update"),
      facebook: Boolean(state.facebookPageConnected && state.facebookConnectionStatus !== "needs_update"),
      instagram: Boolean(state.instagramConnected && state.instagramConnectionStatus !== "needs_update"),
      linkedin: Boolean(state.linkedinConnected && state.linkedinConnectionStatus !== "needs_update"),
      mails: clampMailAccountCount(state.mailAccountsConnectedCount) > 0,
      tiktok: Boolean(state.tiktokConnected),
      youtube_shorts: Boolean(state.youtubeShortsConnected),
      pinterest: Boolean(state.pinterestConnected),
    };
  } catch {
    return {};
  }
}

export function channelConnectivityFromStates(payload: unknown): CachedChannelConnectivity {
  const states = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, any>
    : {};
  const isUsable = (key: string) => {
    const state = states[key] && typeof states[key] === "object" ? states[key] : {};
    return Boolean(state.connected) && state.requiresUpdate !== true;
  };

  return {
    // iNr'Search is not OAuth: its analytics endpoint verifies the actual
    // public page (edition, Bubble Access and publication status). Do not let
    // the lighter settings-only channel state override that stronger result.
    site_inrcy: Boolean(states.site_inrcy?.ga4 || states.site_inrcy?.gsc || states.site_inrcy?.statsConnected),
    site_web: Boolean(states.site_web?.ga4 || states.site_web?.gsc || states.site_web?.statsConnected),
    gmb: isUsable("gmb"),
    facebook: isUsable("facebook"),
    instagram: isUsable("instagram"),
    linkedin: isUsable("linkedin"),
    mails: isUsable("mails"),
    tiktok: isUsable("tiktok"),
    youtube_shorts: isUsable("youtube_shorts"),
    pinterest: isUsable("pinterest"),
  };
}

export function channelConnectionStatusesFromStates(payload: unknown): OfficialChannelConnectionStatuses {
  const states = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, any>
    : {};
  const normalize = (key: string): OfficialChannelConnectionStatus => {
    const state = states[key] && typeof states[key] === "object" ? states[key] : {};
    if (state.requiresUpdate === true || state.connection_status === "needs_update") return "needs_update";
    if (state.connected === true && state.connection_status !== "disconnected") return "connected";
    return "disconnected";
  };

  return {
    // See channelConnectivityFromStates: iNr'Search owns its authoritative
    // public-page status through /api/inr-search/analytics.
    site_inrcy: states.site_inrcy?.statsConnected || states.site_inrcy?.ga4 || states.site_inrcy?.gsc ? "connected" : "disconnected",
    site_web: states.site_web?.statsConnected || states.site_web?.ga4 || states.site_web?.gsc ? "connected" : "disconnected",
    gmb: normalize("gmb"),
    facebook: normalize("facebook"),
    instagram: normalize("instagram"),
    linkedin: normalize("linkedin"),
    mails: normalize("mails"),
    tiktok: normalize("tiktok"),
    youtube_shorts: normalize("youtube_shorts"),
    pinterest: normalize("pinterest"),
  };
}

export function mailStatsSessionKey(period: Period) {
  return `inrcy_stats_mail_snapshot_v3:${period}`;
}

function legacyMailStatsSessionKeys(period: Period) {
  return [
    mailStatsSessionKey(period),
    `inrcy_stats_mail_snapshot_v2:${period}`,
    `inrcy_stats_mail_snapshot_v1:${period}`,
  ];
}

export function normalizeMailStatsSnapshot(value: unknown, syncedAt?: number): MailStatsSnapshot {
  const raw = value && typeof value === "object" ? (value as Partial<MailStatsSnapshot>) : {};
  return {
    loading: false,
    error: typeof raw.error === "string" ? raw.error : undefined,
    connectedCount: clampMailAccountCount(raw.connectedCount),
    maxAccounts: Math.max(1, Math.round(safeNum(raw.maxAccounts, 4)) || 4),
    campagnes30: Math.max(0, Math.round(safeNum(raw.campagnes30))),
    campagnesTotal: Math.max(0, Math.round(safeNum(raw.campagnesTotal, safeNum(raw.campagnes30)))),
    destinataires30: Math.max(0, Math.round(safeNum(raw.destinataires30))),
    contactsCrm: Math.max(0, Math.round(safeNum(raw.contactsCrm))),
    contactsEmail: Math.max(0, Math.round(safeNum(raw.contactsEmail, safeNum(raw.contactsCrm)))),
    propulsions30: Math.max(0, Math.round(safeNum(raw.propulsions30))),
    fidelisations30: Math.max(0, Math.round(safeNum(raw.fidelisations30))),
    mailsSimples30: Math.max(0, Math.round(safeNum(raw.mailsSimples30, safeNum((raw as any).inrsend30)))),
    agendaReminders30: Math.max(0, Math.round(safeNum(raw.agendaReminders30))),
    agendaRemindersTotal: Math.max(0, Math.round(safeNum(raw.agendaRemindersTotal, safeNum(raw.agendaReminders30)))),
    factures30: Math.max(0, Math.round(safeNum(raw.factures30))),
    facturesTotal: Math.max(0, Math.round(safeNum(raw.facturesTotal, safeNum(raw.factures30)))),
    devis30: Math.max(0, Math.round(safeNum(raw.devis30))),
    devisTotal: Math.max(0, Math.round(safeNum(raw.devisTotal, safeNum(raw.devis30)))),
    destinatairesTotal: Math.max(0, Math.round(safeNum(raw.destinatairesTotal, safeNum(raw.destinataires30)))),
    breakdown: raw.breakdown && typeof raw.breakdown === "object" ? raw.breakdown : undefined,
    syncedAt: Number.isFinite(Number(syncedAt ?? raw.syncedAt)) ? Number(syncedAt ?? raw.syncedAt) : undefined,
  };
}

function parseCachedMailStats(raw: string | null): { syncedAt: number; snapshotDate: string | null; stats: MailStatsSnapshot } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    const syncedAt = safeNum(parsed?.syncedAt);
    const stats = normalizeMailStatsSnapshot(parsed?.stats ?? parsed, syncedAt);
    if (!syncedAt && !stats.syncedAt) return null;
    return {
      syncedAt: syncedAt || safeNum(stats.syncedAt),
      snapshotDate: typeof parsed?.snapshotDate === "string" ? parsed.snapshotDate : null,
      stats,
    };
  } catch {
    return null;
  }
}

export function readCachedMailStats(period: Period) {
  for (const key of legacyMailStatsSessionKeys(period)) {
    const cached = parseCachedMailStats(readUiCacheValue(key));
    if (!cached) continue;
    const age = Date.now() - cached.syncedAt;
    if (!Number.isFinite(age) || age < 0 || age > MAIL_STATS_CACHE_TTL_MS) continue;
    return cached;
  }
  return null;
}

function readCachedDashboardMailAccountsConnectedCount(): number | null {
  try {
    const state = readCachedDashboardChannelState();
    if (!state) return null;

    if (Object.prototype.hasOwnProperty.call(state, "mailAccountsConnectedCount")) {
      return clampMailAccountCount(state.mailAccountsConnectedCount);
    }

    if (state.mails && typeof state.mails === "object" && Object.prototype.hasOwnProperty.call(state.mails, "connectedCount")) {
      return clampMailAccountCount(state.mails.connectedCount);
    }
  } catch {
    // cache UI uniquement, sans impact fonctionnel
  }

  return null;
}

export function buildInitialMailStatsSnapshot(period: Period): MailStatsSnapshot {
  const cachedMail = readCachedMailStats(period);
  if (cachedMail) {
    return { ...cachedMail.stats, loading: false, error: undefined, syncedAt: cachedMail.syncedAt };
  }

  const cachedDashboardConnectedCount = readCachedDashboardMailAccountsConnectedCount();
  if (cachedDashboardConnectedCount !== null) {
    return {
      ...EMPTY_MAIL_STATS,
      loading: true,
      connectedCount: cachedDashboardConnectedCount,
      syncedAt: Date.now(),
    };
  }

  return EMPTY_MAIL_STATS;
}

export function writeCachedMailStats(period: Period, stats: MailStatsSnapshot, syncedAt = Date.now()) {
  try {
    writeUiCacheValue(mailStatsSessionKey(period), JSON.stringify({
      syncedAt,
      snapshotDate: expectedUiSnapshotDate(),
      stats: normalizeMailStatsSnapshot(stats, syncedAt),
    }));
  } catch {
    // cache UI uniquement, sans impact fonctionnel
  }
}

function clampMailAccountCount(value: unknown) {
  return Math.max(0, Math.min(4, Math.round(safeNum(value))));
}

export function buildMailOpportunity30(stats: MailStatsSnapshot) {
  if (stats.connectedCount <= 0) return 0;
  const base = stats.campagnes30 <= 0 ? 8 : 3;
  const contactsPotential = Math.min(28, (stats.contactsEmail || stats.contactsCrm) / 14);
  const activityPotential = Math.min(14, stats.campagnes30 * 2 + stats.destinataires30 / 45 + stats.agendaReminders30 / 20);
  return Math.max(0, Math.round(base + contactsPotential + activityPotential));
}

export function buildMailCubeModel(stats: MailStatsSnapshot, period: Period, locale: string, t: StatsTranslator): CubeModel {
  const formatInt = (value: number) => fmtInt(value, locale);
  const connected = stats.connectedCount > 0;
  const opportunity30 = buildMailOpportunity30(stats);
  const contactsEmail = stats.contactsEmail || stats.contactsCrm;
  const qualityScore = !connected
    ? 0
    : Math.max(35, Math.min(92, Math.round(
      36
      + Math.min(24, stats.connectedCount * 8)
      + Math.min(16, contactsEmail / 14)
      + Math.min(10, stats.campagnes30 * 2)
      + Math.min(6, stats.agendaReminders30 / 5),
    )));
  const qualityLabel = qualityScore >= 75
    ? t("solide_ab31c54d")
    : qualityScore >= 55
      ? t("correct_48e09e45")
      : connected
        ? t("quality_needs_work")
        : t("quality_connect_required");
  const qualityTone: CubeModel["qualityTone"] = qualityScore >= 80 ? "excellent" : qualityScore >= 65 ? "solid" : qualityScore >= 45 ? "ok" : "low";

  const propulserBreakdown = stats.breakdown?.propulser || {};
  const fideliserBreakdown = stats.breakdown?.fideliser || {};

  const recommendedAction = (() => {
    if (!connected) {
      return {
        key: "connect" as const,
        title: t("configurer_382efbe9"),
        detail: t("mail_connect_channel_detail"),
        href: "/dashboard?panel=mails",
        pill: t("connexion_a33c58f5"),
      };
    }
    if (stats.fidelisations30 <= 0 || stats.fidelisations30 <= stats.propulsions30) {
      return {
        key: "fideliser_action" as const,
        title: t("fideliser_8fa9e4f1"),
        detail: t("mail_nurture_action_detail"),
        href: "/dashboard/fideliser",
        pill: t("fideliser_8fa9e4f1"),
        effort: { level: "moyen" as const, label: t("effort_moyen_10_15_min_33514efc") },
      };
    }
    if (stats.propulsions30 <= 0 || stats.propulsions30 < stats.fidelisations30) {
      return {
        key: "propulser_action" as const,
        title: t("propulser_2de43942"),
        detail: t("mail_propulser_action_detail"),
        href: "/dashboard/propulser",
        pill: t("propulser_2de43942"),
        effort: { level: "moyen" as const, label: t("effort_moyen_10_15_min_33514efc") },
      };
    }
    return {
      key: "mail_simple" as const,
      title: t("creer_un_mail_simple_cbf8291d"),
      detail: t("mail_simple_action_detail"),
      href: "/dashboard/mails?compose=1",
      pill: t("mail_simple_label"),
      effort: { level: "faible" as const, label: t("effort_faible_3_5_min_7dd198dc") },
    };
  })();

  const connectionPending = stats.loading && stats.connectedCount <= 0;

  return {
    key: "mails",
    title: t("mails_8d79d3a8"),
    subtitle: t("actions_mails_par_usage_ee21b9bd"),
    accountLabel: connected
      ? t("mail_connected_accounts", { count: stats.connectedCount, max: stats.maxAccounts })
      : connectionPending
        ? t("verification_in_progress")
        : t("mail_accounts_to_connect", { max: stats.maxAccounts }),
    period,
    loading: stats.loading,
    error: stats.error,
    connections: { main: connected },
    connectionPending,
    provenance: [
      { label: t("valoriser_0859943f"), value: safeNum(propulserBreakdown.valoriser), colorVar: "--cValoriser" },
      { label: t("recolter_1d0f06aa"), value: safeNum(propulserBreakdown.recolter), colorVar: "--cRecolter" },
      { label: t("offrir_48d9d533"), value: safeNum(propulserBreakdown.offrir), colorVar: "--cOffrir" },
      { label: t("informer_570ee22d"), value: safeNum(fideliserBreakdown.informer), colorVar: "--cInformer" },
      { label: t("suivre_7cca6c92"), value: safeNum(fideliserBreakdown.suivre), colorVar: "--cSuivre" },
      { label: t("enqueter_4fd8cc8c"), value: safeNum(fideliserBreakdown.enqueter), colorVar: "--cEnqueter" },
      { label: t("mails_simples_608d9dcf"), value: stats.mailsSimples30, colorVar: "--cMailSimple" },
    ],
    provenanceHint: undefined,
    opportunity30,
    opportunityLabel: opportunity30 >= 14
      ? t("opportunity_high")
      : opportunity30 >= 7
        ? t("opportunity_real")
        : connected
          ? t("opportunity_to_develop")
          : t("a_activer_15406658"),
    capturedLeads: { week: 0, month: 0 },
    capturedLeadsUnavailable: true,
    capturedLeadsHint: connected
      ? t("mail_measurement_hint")
      : t("mail_connect_hint"),
    visibilityStats: connected
      ? [
          { label: t("boites_63c5cc0d"), value: `${formatInt(stats.connectedCount)}/${formatInt(stats.maxAccounts)}` },
          { label: t("contacts_email_90f13253"), value: formatInt(contactsEmail) },
        ]
      : [],
    actionStats: connected
      ? [
          { label: t("rappels_agenda_30j_e3c4a01a"), value: formatInt(stats.agendaReminders30), subValue: t("metric_total_count", { count: formatInt(stats.agendaRemindersTotal) }) },
          { label: t("factures_30j_1624acb4"), value: formatInt(stats.factures30), subValue: t("metric_total_count", { count: formatInt(stats.facturesTotal) }) },
          { label: t("devis_30j_5132b47f"), value: formatInt(stats.devis30), subValue: t("metric_total_count", { count: formatInt(stats.devisTotal) }) },
        ]
      : [],
    inrcyActivityStats: {
      publications: { week: 0, month: Math.max(0, stats.campagnes30), total: Math.max(0, stats.campagnesTotal) },
      photos: { week: 0, month: Math.max(0, stats.mailsSimples30), total: Math.max(0, stats.mailsSimples30) },
      videos: { week: 0, month: Math.max(0, stats.destinataires30), total: Math.max(0, stats.destinatairesTotal) },
    },
    qualityScore,
    qualityLabel,
    qualityTone,
    insights: connected
      ? [
          t("mail_insight_connected_accounts", { count: stats.connectedCount, max: stats.maxAccounts }),
          t("mail_insight_usable_contacts", { count: formatInt(contactsEmail) }),
          t("mail_insight_campaigns", { month: formatInt(stats.campagnes30), total: formatInt(stats.campagnesTotal) }),
          t("mail_insight_recipients", { month: formatInt(stats.destinataires30), total: formatInt(stats.destinatairesTotal) }),
          t("mail_insight_documents", { reminders: formatInt(stats.agendaReminders30), invoices: formatInt(stats.factures30), quotes: formatInt(stats.devis30) }),
        ]
      : [
          t("insight_mail_disconnected"),
          t("mail_connect_to_unlock_tools"),
        ],
    action: recommendedAction,
  };
}
export function buildInrBadgeCubeModel(
  period: Period,
  stats: InrBadgeStatsSnapshot,
  options: { appointmentsEnabled?: boolean } = {},
  locale = "fr-FR",
  t?: StatsTranslator,
): CubeModel {
  if (!t) throw new Error("buildInrBadgeCubeModel requires a stats translator");
  const formatInt = (value: number) => fmtInt(value, locale);
  const appointmentsEnabled = options.appointmentsEnabled !== false;
  const action = (key: string) => normalizeInrBadgePeriodStats(stats.actionsByKey?.[key]);
  const views = normalizeInrBadgePeriodStats(stats.views);
  const qrScans = normalizeInrBadgePeriodStats(stats.qrScans);
  const actions = normalizeInrBadgePeriodStats(stats.actions);
  const leads = normalizeInrBadgePeriodStats(stats.leads);
  const appointments = normalizeInrBadgePeriodStats(stats.appointments);
  const capturedLeads = normalizeCapturedLeads(stats.capturedLeads);
  const qualityScore = Math.max(0, Math.min(100, Math.round(safeNum(stats.qualityScore, 52))));
  const qualityLabel = qualityScore >= 82
    ? t("quality_very_active")
    : qualityScore >= 68
      ? t("quality_active")
      : qualityScore >= 55
        ? t("quality_to_boost")
        : t("quality_to_launch");
  const qualityTone: CubeModel["qualityTone"] = qualityScore >= 82 ? "excellent" : qualityScore >= 68 ? "solid" : qualityScore >= 55 ? "ok" : "low";
  const opportunity30 = Math.max(0, Math.round(safeNum(stats.opportunity30)));
  const hasActivity = views.month > 0 || qrScans.month > 0 || actions.month > 0 || capturedLeads.month > 0;

  return {
    key: "inrbadge",
    title: t("inr_badge_e95acd12"),
    subtitle: t("hub_de_conversion_2d028079"),
    accountLabel: stats.loading ? t("analysis_status") : t("connecte_ce09957c"),
    period,
    loading: stats.loading,
    error: stats.error,
    connections: { main: true },
    provenance: [
      { label: t("vues_fiche_6d715930"), value: views.month, colorVar: "--cSocial" },
      { label: t("scans_qr_a36ab7c7"), value: qrScans.month, colorVar: "--cDirect" },
      { label: t("actions_c3cd636a"), value: actions.month, colorVar: "--cGoogle" },
    ],
    provenanceHint: hasActivity
      ? t("badge_real_distribution_hint")
      : t("badge_stats_start_hint"),
    opportunity30,
    opportunityLabel: opportunity30 >= 18 ? t("opportunity_high") : opportunity30 >= 8 ? t("opportunity_real") : t("badge_hub_active"),
    capturedLeads,
    capturedLeadsHint: appointmentsEnabled
      ? t("badge_leads_with_appointments_hint")
      : t("badge_leads_hint"),
    visibilityStats: [
      { label: t("fiche_publique_ddee72e7"), value: t("status_active_feminine") },
      { label: t("vues_30j_af08848c"), value: formatInt(views.month), subValue: t("metric_total_count", { count: formatInt(views.total) }) },
      { label: t("scans_qr_30j_d500cdba"), value: formatInt(qrScans.month), subValue: t("metric_total_count", { count: formatInt(qrScans.total) }) },
      { label: t("cta_rapides_3195b9c7"), value: t("status_tracked_plural") },
    ],
    actionStats: [
      { label: t("appels_30j_6785b4d1"), value: formatInt(action("phone").month), subValue: t("metric_total_count", { count: formatInt(action("phone").total) }) },
      { label: t("mails_30j_f8e114bf"), value: formatInt(action("mail").month), subValue: t("metric_total_count", { count: formatInt(action("mail").total) }) },
      { label: t("contacts_30j_d0475df5"), value: formatInt(leads.month), subValue: t("metric_total_count", { count: formatInt(leads.total) }) },
      appointmentsEnabled
        ? { label: t("rdv_30j_395436a0"), value: formatInt(appointments.month), subValue: t("metric_total_count", { count: formatInt(appointments.total) }) }
        : null,
    ].filter((item): item is NonNullable<typeof item> => item !== null),
    inrcyActivityStats: {
      publications: views,
      photos: qrScans,
      videos: actions,
    },
    qualityScore,
    qualityLabel,
    qualityTone,
    insights: hasActivity
      ? [
          t("badge_insight_views", { month: formatInt(views.month), week: formatInt(views.week) }),
          t("badge_insight_scans_actions", { scans: formatInt(qrScans.month), actions: formatInt(actions.month) }),
          appointmentsEnabled
            ? t("badge_insight_leads_with_appointments", { count: formatInt(capturedLeads.month) })
            : t("badge_insight_contacts", { count: formatInt(capturedLeads.month) }),
        ]
      : [
          t("badge_tracking_active"),
          appointmentsEnabled
            ? t("badge_future_activity_with_appointments")
            : t("badge_future_activity"),
          t("badge_share_downloaded_qr"),
        ],
    action: {
      key: "booster_promotion",
      title: t("partager_votre_badge_79a471a0"),
      detail: t("badge_share_action_detail"),
      href: "/dashboard?panel=inrbadge",
      pill: t("booster_8e4caec0"),
      effort: { level: "faible", label: t("rapide_ea7cac7d") },
    },
  };
}


export function buildInrSearchOpportunity30(stats: InrSearchStatsSnapshot) {
  if (!stats.enabled) return 0;

  const action = (key: string) => Math.max(0, safeNum(stats.actionsByKey[key]));
  const directContacts = Math.max(0, safeNum(stats.contactActions.month));
  const strongIntent = action("website") + action("directions") + action("inrbadge");
  const qualityBase = 4 + Math.min(5, Math.max(0, safeNum(stats.qualityScore)) / 20);
  const visibilityPotential = Math.min(30, Math.max(0, safeNum(stats.views.month)) / 6);
  const intentPotential = Math.min(18, strongIntent * 0.75 + directContacts * 1.5);

  // iNr'Search combine la logique d'une page web (visibilité et qualité)
  // avec les signaux forts d'iNr'Badge (fiche, itinéraire, contact).
  return Math.max(directContacts, Math.round(qualityBase + visibilityPotential + intentPotential));
}

export function buildInrSearchCubeModel(period: Period, stats: InrSearchStatsSnapshot, locale: string, t: StatsTranslator): CubeModel {
  const formatInt = (value: number) => fmtInt(value, locale);
  const actions = (key: string) => Math.max(0, Math.round(safeNum(stats.actionsByKey[key])));
  const engines = Math.max(0, Math.round(safeNum(stats.sources.google) + safeNum(stats.sources.bing)));
  const aiEngines = Math.max(0, Math.round(
    safeNum(stats.sources.chatgpt) +
    safeNum(stats.sources.gemini) +
    safeNum(stats.sources.perplexity) +
    safeNum(stats.sources.copilot),
  ));
  const social = Math.max(0, Math.round(safeNum(stats.sources.social)));
  const direct = Math.max(0, Math.round(safeNum(stats.sources.direct) + safeNum(stats.sources.other)));
  const opportunity30 = buildInrSearchOpportunity30(stats);
  const hasActivity = stats.views.month > 0 || stats.actions.month > 0;
  const qualityScore = Math.max(0, Math.min(100, Math.round(safeNum(stats.qualityScore))));
  const qualityLabel = qualityScore >= 82
    ? t("quality_very_complete")
    : qualityScore >= 68
      ? t("solide_ab31c54d")
      : qualityScore >= 50
        ? t("quality_to_enrich")
        : t("quality_in_preparation");
  const qualityTone: CubeModel["qualityTone"] = qualityScore >= 82 ? "excellent" : qualityScore >= 68 ? "solid" : qualityScore >= 50 ? "ok" : "low";

  return {
    key: "inr_search",
    title: t("inr_search_48e0df93"),
    subtitle: t("votre_page_publique_1adfbc96"),
    accountLabel: stats.loading ? t("analysis_status") : stats.enabled ? (stats.pageTitle || t("page_publiee_1916dffd")) : t("quality_in_preparation"),
    period,
    loading: stats.loading,
    error: stats.error,
    connections: { main: stats.enabled },
    provenance: [
      { label: t("google_bing_eca554fe"), value: engines, colorVar: "--cGoogle" },
      { label: t("moteurs_ia_8871c7ec"), value: aiEngines, colorVar: "--cSocial" },
      { label: t("reseaux_sociaux_4b975571"), value: social, colorVar: "--cDirect" },
      { label: t("acces_direct_6113899e"), value: direct, colorVar: "--cOther" },
    ],
    provenanceHint: hasActivity
      ? t("search_real_sources_hint")
      : t("search_sources_start_hint"),
    opportunity30,
    opportunityLabel: opportunity30 > 0 ? t("search_estimated_potential") : t("search_active_visibility"),
    capturedLeads: {
      week: Math.max(0, Math.round(safeNum(stats.contactActions.week))),
      month: Math.max(0, Math.round(safeNum(stats.contactActions.month))),
    },
    capturedLeadsHint: t("appels_emails_et_demandes_envoyees_depuis_5f709355"),
    visibilityStats: [
      { label: t("vues_7j_e2181bf1"), value: formatInt(stats.views.week) },
      { label: t("vues_30j_af08848c"), value: formatInt(stats.views.month), subValue: t("metric_total_count", { count: formatInt(stats.views.total) }) },
      { label: t("actions_30j_d501b2d0"), value: formatInt(stats.actions.month), subValue: t("metric_total_count", { count: formatInt(stats.actions.total) }) },
      { label: t("taux_d_action_918ffc16"), value: stats.views.month > 0 ? `${Math.round((stats.actions.month / stats.views.month) * 100)}%` : "0%" },
    ],
    actionStats: [
      { label: t("appels_30j_6785b4d1"), value: formatInt(actions("phone")) },
      { label: t("demandes_formulaire_30j_2c7a5939"), value: formatInt(actions("lead_form")) },
      { label: t("emails_30j_2ccce3e9"), value: formatInt(actions("email") + actions("faq_contact")) },
      { label: t("visites_du_site_30j_22c30531"), value: formatInt(actions("website")) },
      { label: t("ouvertures_inr_badge_30j_ae971174"), value: formatInt(actions("inrbadge")) },
      { label: t("itineraires_30j_4bd37286"), value: formatInt(actions("directions")) },
    ],
    inrcyActivityStats: {
      publications: stats.views,
      photos: stats.actions,
      videos: {
        week: Math.max(0, Math.round(safeNum(stats.contactActions.week))),
        month: opportunity30,
        total: Math.max(0, Math.round(safeNum(stats.contactActions.month))),
      },
    },
    qualityScore,
    qualityLabel,
    qualityTone,
    insights: hasActivity
      ? [
          t("search_insight_views", { month: formatInt(stats.views.month), week: formatInt(stats.views.week) }),
          t("search_insight_actions_potential", { actions: formatInt(stats.actions.month), opportunities: formatInt(opportunity30) }),
          stats.topSource ? t("search_insight_top_source", { source: stats.topSource.key }) : t("search_insight_sources_automatic"),
        ]
      : [
          stats.enabled ? t("search_page_tracking_active") : t("search_page_in_preparation"),
          t("search_future_activity"),
        ],
    action: stats.enabled && stats.publicUrl
      ? {
          key: "booster_publier",
          title: t("publier_sur_inr_search_31302b2a"),
          detail: t("search_publish_action_detail"),
          href: "/dashboard?action=publish",
          pill: t("booster_8e4caec0"),
          effort: { level: "faible", label: t("rapide_ea7cac7d") },
        }
      : {
          key: "connect",
          title: t("page_en_preparation_4f41e9fc"),
          detail: t("search_auto_publish_detail"),
          href: "/dashboard?panel=inr_search",
          pill: t("connexion_a33c58f5"),
          effort: { level: "faible", label: t("automatique_f8a3c37b") },
        },
  };
}
