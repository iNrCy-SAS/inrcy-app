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

export function buildMailCubeModel(stats: MailStatsSnapshot, period: Period): CubeModel {
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
  const qualityLabel = qualityScore >= 75 ? "Solide" : qualityScore >= 55 ? "Correct" : connected ? "À travailler" : "À connecter";
  const qualityTone: CubeModel["qualityTone"] = qualityScore >= 80 ? "excellent" : qualityScore >= 65 ? "solid" : qualityScore >= 45 ? "ok" : "low";

  const propulserBreakdown = stats.breakdown?.propulser || {};
  const fideliserBreakdown = stats.breakdown?.fideliser || {};

  const recommendedAction = (() => {
    if (!connected) {
      return {
        key: "connect" as const,
        title: "Configurer",
        detail: "Connectez une boîte d’envoi pour activer le canal Mails.",
        href: "/dashboard?panel=mails",
        pill: "Connexion" as const,
      };
    }
    if (stats.fidelisations30 <= 0 || stats.fidelisations30 <= stats.propulsions30) {
      return {
        key: "fideliser_action" as const,
        title: "Fidéliser",
        detail: "Animez votre base client avec une campagne relationnelle claire.",
        href: "/dashboard/fideliser",
        pill: "Fidéliser" as const,
        effort: { level: "moyen" as const, label: "Effort moyen • 10-15 min" },
      };
    }
    if (stats.propulsions30 <= 0 || stats.propulsions30 < stats.fidelisations30) {
      return {
        key: "propulser_action" as const,
        title: "Propulser",
        detail: "Lancez une action commerciale par mail : valoriser, récolter ou offrir.",
        href: "/dashboard/propulser",
        pill: "Propulser" as const,
        effort: { level: "moyen" as const, label: "Effort moyen • 10-15 min" },
      };
    }
    return {
      key: "mail_simple" as const,
      title: "Créer un mail simple",
      detail: "Envoyez un message libre depuis une boîte mail connectée.",
      href: "/dashboard/mails?compose=1",
      pill: "Mail simple" as const,
      effort: { level: "faible" as const, label: "Effort faible • 3-5 min" },
    };
  })();

  const connectionPending = stats.loading && stats.connectedCount <= 0;

  return {
    key: "mails",
    title: "Mails",
    subtitle: "Actions mails par usage.",
    accountLabel: connected
      ? `Connecté ${stats.connectedCount}/${stats.maxAccounts}`
      : connectionPending
        ? "Vérification en cours..."
        : `À connecter 0/${stats.maxAccounts}`,
    period,
    loading: stats.loading,
    error: stats.error,
    connections: { main: connected },
    connectionPending,
    provenance: [
      { label: "Valoriser", value: safeNum(propulserBreakdown.valoriser), colorVar: "--cValoriser" },
      { label: "Récolter", value: safeNum(propulserBreakdown.recolter), colorVar: "--cRecolter" },
      { label: "Offrir", value: safeNum(propulserBreakdown.offrir), colorVar: "--cOffrir" },
      { label: "Informer", value: safeNum(fideliserBreakdown.informer), colorVar: "--cInformer" },
      { label: "Suivre", value: safeNum(fideliserBreakdown.suivre), colorVar: "--cSuivre" },
      { label: "Enquêter", value: safeNum(fideliserBreakdown.enqueter), colorVar: "--cEnqueter" },
      { label: "Mails simples", value: stats.mailsSimples30, colorVar: "--cMailSimple" },
    ],
    provenanceHint: undefined,
    opportunity30,
    opportunityLabel: opportunity30 >= 14 ? "Fort potentiel" : opportunity30 >= 7 ? "Potentiel réel" : connected ? "À développer" : "À activer",
    capturedLeads: { week: 0, month: 0 },
    capturedLeadsUnavailable: true,
    capturedLeadsHint: connected
      ? "Le canal Mails mesure vos actions Fidéliser, Propulser, mails simples et envois automatiques."
      : "Connectez une boîte mail pour activer ce canal.",
    visibilityStats: connected
      ? [
          { label: "Boîtes", value: `${fmtInt(stats.connectedCount)}/${fmtInt(stats.maxAccounts)}` },
          { label: "Contacts email", value: fmtInt(contactsEmail) },
        ]
      : [],
    actionStats: connected
      ? [
          { label: "Rappels Agenda 30j", value: fmtInt(stats.agendaReminders30), subValue: `${fmtInt(stats.agendaRemindersTotal)} au total` },
          { label: "Factures 30j", value: fmtInt(stats.factures30), subValue: `${fmtInt(stats.facturesTotal)} au total` },
          { label: "Devis 30j", value: fmtInt(stats.devis30), subValue: `${fmtInt(stats.devisTotal)} au total` },
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
          `Boîtes connectées : ${stats.connectedCount}/${stats.maxAccounts}.`,
          `${fmtInt(contactsEmail)} contacts email exploitables pour vos actions mails.`,
          `${fmtInt(stats.campagnes30)} campagnes sur 30 jours, ${fmtInt(stats.campagnesTotal)} au total.`,
          `${fmtInt(stats.destinataires30)} destinataires touchés sur 30 jours, ${fmtInt(stats.destinatairesTotal)} au total.`,
          `${fmtInt(stats.agendaReminders30)} rappels Agenda, ${fmtInt(stats.factures30)} factures et ${fmtInt(stats.devis30)} devis envoyés sur 30 jours.`,
        ]
      : [
          "Canal mail non connecté.",
          "Connectez au moins une boîte d’envoi pour débloquer Fidéliser, Propulser et les mails simples.",
        ],
    action: recommendedAction,
  };
}
export function buildInrBadgeCubeModel(
  period: Period,
  stats: InrBadgeStatsSnapshot,
  options: { appointmentsEnabled?: boolean } = {},
): CubeModel {
  const appointmentsEnabled = options.appointmentsEnabled !== false;
  const action = (key: string) => normalizeInrBadgePeriodStats(stats.actionsByKey?.[key]);
  const views = normalizeInrBadgePeriodStats(stats.views);
  const qrScans = normalizeInrBadgePeriodStats(stats.qrScans);
  const actions = normalizeInrBadgePeriodStats(stats.actions);
  const leads = normalizeInrBadgePeriodStats(stats.leads);
  const appointments = normalizeInrBadgePeriodStats(stats.appointments);
  const capturedLeads = normalizeCapturedLeads(stats.capturedLeads);
  const qualityScore = Math.max(0, Math.min(100, Math.round(safeNum(stats.qualityScore, 52))));
  const qualityLabel = qualityScore >= 82 ? "Très actif" : qualityScore >= 68 ? "Actif" : qualityScore >= 55 ? "À booster" : "À lancer";
  const qualityTone: CubeModel["qualityTone"] = qualityScore >= 82 ? "excellent" : qualityScore >= 68 ? "solid" : qualityScore >= 55 ? "ok" : "low";
  const opportunity30 = Math.max(0, Math.round(safeNum(stats.opportunity30)));
  const hasActivity = views.month > 0 || qrScans.month > 0 || actions.month > 0 || capturedLeads.month > 0;

  return {
    key: "inrbadge",
    title: "iNr’Badge",
    subtitle: "Hub de conversion",
    accountLabel: stats.loading ? "Analyse..." : "Connecté",
    period,
    loading: stats.loading,
    error: stats.error,
    connections: { main: true },
    provenance: [
      { label: "Vues fiche", value: views.month, colorVar: "--cSocial" },
      { label: "Scans QR", value: qrScans.month, colorVar: "--cDirect" },
      { label: "Actions", value: actions.month, colorVar: "--cGoogle" },
    ],
    provenanceHint: hasActivity
      ? "Répartition réelle des vues, scans QR et clics iNr’Badge sur 30 jours."
      : "Les statistiques réelles démarrent dès les prochaines visites de la fiche publique.",
    opportunity30,
    opportunityLabel: opportunity30 >= 18 ? "Fort potentiel" : opportunity30 >= 8 ? "Potentiel réel" : "Hub actif",
    capturedLeads,
    capturedLeadsHint: appointmentsEnabled
      ? "Coordonnées transmises + demandes de RDV issues de votre iNr’Badge."
      : "Coordonnées transmises depuis votre iNr’Badge.",
    visibilityStats: [
      { label: "Fiche publique", value: "Active" },
      { label: "Vues 30j", value: fmtInt(views.month), subValue: `${fmtInt(views.total)} au total` },
      { label: "Scans QR 30j", value: fmtInt(qrScans.month), subValue: `${fmtInt(qrScans.total)} au total` },
      { label: "CTA rapides", value: "Trackés" },
    ],
    actionStats: [
      { label: "Appels 30j", value: fmtInt(action("phone").month), subValue: `${fmtInt(action("phone").total)} au total` },
      { label: "Mails 30j", value: fmtInt(action("mail").month), subValue: `${fmtInt(action("mail").total)} au total` },
      { label: "Contacts 30j", value: fmtInt(leads.month), subValue: `${fmtInt(leads.total)} au total` },
      appointmentsEnabled
        ? { label: "RDV 30j", value: fmtInt(appointments.month), subValue: `${fmtInt(appointments.total)} au total` }
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
          `${fmtInt(views.month)} vues de fiche sur 30 jours, dont ${fmtInt(views.week)} sur 7 jours.`,
          `${fmtInt(qrScans.month)} scans QR et ${fmtInt(actions.month)} actions utiles sur 30 jours.`,
          appointmentsEnabled
            ? `${fmtInt(capturedLeads.month)} demandes captées via coordonnées ou prise de RDV sur 30 jours.`
            : `${fmtInt(capturedLeads.month)} contacts captés via votre iNr’Badge sur 30 jours.`,
        ]
      : [
          "Le tracking réel iNr’Badge est actif.",
          appointmentsEnabled
            ? "Les prochaines ouvertures, scans QR, clics, contacts et demandes de RDV remonteront ici."
            : "Les prochaines ouvertures, scans QR, clics et contacts remonteront ici.",
          "Diffusez le QR Code avec la version téléchargée depuis Configuration pour mesurer les scans.",
        ],
    action: {
      key: "booster_promotion",
      title: "Partager votre badge",
      detail: "Diffusez votre fiche publique et votre QR Code pour générer plus d’actions utiles.",
      href: "/dashboard?panel=inrbadge",
      pill: "Booster",
      effort: { level: "faible", label: "Rapide" },
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

export function buildInrSearchCubeModel(period: Period, stats: InrSearchStatsSnapshot): CubeModel {
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
  const qualityLabel = qualityScore >= 82 ? "Très complète" : qualityScore >= 68 ? "Solide" : qualityScore >= 50 ? "À enrichir" : "En préparation";
  const qualityTone: CubeModel["qualityTone"] = qualityScore >= 82 ? "excellent" : qualityScore >= 68 ? "solid" : qualityScore >= 50 ? "ok" : "low";

  return {
    key: "inr_search",
    title: "iNr’Search",
    subtitle: "Votre page publique",
    accountLabel: stats.loading ? "Analyse…" : stats.enabled ? (stats.pageTitle || "Page publiée") : "En préparation",
    period,
    loading: stats.loading,
    error: stats.error,
    connections: { main: stats.enabled },
    provenance: [
      { label: "Google & Bing", value: engines, colorVar: "--cGoogle" },
      { label: "Moteurs IA", value: aiEngines, colorVar: "--cSocial" },
      { label: "Réseaux sociaux", value: social, colorVar: "--cDirect" },
      { label: "Accès direct", value: direct, colorVar: "--cOther" },
    ],
    provenanceHint: hasActivity
      ? "Origine réelle des visites de votre page iNr’Search sur les 30 derniers jours."
      : "Les sources apparaîtront dès les premières visites de la page publique.",
    opportunity30,
    opportunityLabel: opportunity30 > 0 ? "Potentiel estimé" : "Visibilité active",
    capturedLeads: {
      week: Math.max(0, Math.round(safeNum(stats.contactActions.week))),
      month: Math.max(0, Math.round(safeNum(stats.contactActions.month))),
    },
    capturedLeadsHint: "Appels, emails et demandes envoyées depuis la page publique.",
    visibilityStats: [
      { label: "Vues 7j", value: fmtInt(stats.views.week) },
      { label: "Vues 30j", value: fmtInt(stats.views.month), subValue: `${fmtInt(stats.views.total)} au total` },
      { label: "Actions 30j", value: fmtInt(stats.actions.month), subValue: `${fmtInt(stats.actions.total)} au total` },
      { label: "Taux d’action", value: stats.views.month > 0 ? `${Math.round((stats.actions.month / stats.views.month) * 100)}%` : "0%" },
    ],
    actionStats: [
      { label: "Appels 30j", value: fmtInt(actions("phone")) },
      { label: "Demandes formulaire 30j", value: fmtInt(actions("lead_form")) },
      { label: "Emails 30j", value: fmtInt(actions("email") + actions("faq_contact")) },
      { label: "Visites du site 30j", value: fmtInt(actions("website")) },
      { label: "Ouvertures iNr'Badge 30j", value: fmtInt(actions("inrbadge")) },
      { label: "Itinéraires 30j", value: fmtInt(actions("directions")) },
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
          `${fmtInt(stats.views.month)} vues sur 30 jours, dont ${fmtInt(stats.views.week)} sur 7 jours.`,
          `${fmtInt(stats.actions.month)} actions utiles et un potentiel estimé de ${fmtInt(opportunity30)} opportunités sur 30 jours.`,
          stats.topSource ? `Première source de trafic : ${stats.topSource.key}.` : "Les sources de trafic sont mesurées automatiquement.",
        ]
      : [
          stats.enabled ? "La page iNr’Search est publiée et son suivi statistique est actif." : "La page iNr’Search est en préparation.",
          "Les vues, sources, appels, emails et clics remonteront automatiquement dans iNr’Stats.",
        ],
    action: stats.enabled && stats.publicUrl
      ? {
          key: "booster_publier",
          title: "Publier sur iNr’Search",
          detail: "Diffusez une actualité web dédiée sur la page publique depuis Booster.",
          href: "/dashboard?action=publish",
          pill: "Booster",
          effort: { level: "faible", label: "Rapide" },
        }
      : {
          key: "connect",
          title: "Page en préparation",
          detail: "iNrCy publiera automatiquement la page dès que l’identité de l’entreprise sera disponible.",
          href: "/dashboard?panel=inr_search",
          pill: "Connexion",
          effort: { level: "faible", label: "Automatique" },
        },
  };
}
