import { type InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";

export type Overview = {
  inrcySiteOwnership?: "none" | "sold" | "rented";
  days: number;
  business?: { sectorCategory?: string | null; profession?: string | null };
  totals: {
    users: number;
    sessions: number;
    pageviews: number;
    engagementRate: number;
    avgSessionDuration: number;
    clicks: number;
    impressions: number;
    ctr: number;
  };
  topPages: Array<{ path: string; views: number }>;
  channels: Array<{ channel: string; sessions: number }>;
  topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  sources: {
    site_inrcy: { connected: { ga4: boolean; gsc: boolean } };
    site_web: { connected: { ga4: boolean; gsc: boolean } };
    gmb: { connected: boolean; metrics: any | null };
    facebook: { connected: boolean; metrics?: any | null };
    instagram: { connected: boolean; metrics?: any | null };
    linkedin: { connected: boolean; metrics?: any | null };
    tiktok: { connected: boolean; metrics?: any | null };
    youtube_shorts?: { connected: boolean; metrics?: any | null };
    pinterest?: { connected: boolean; metrics?: any | null };
    mails?: { connected: boolean; metrics?: any | null };
  };
  inrcyActivity?: Partial<Record<CubeKey, InrcyActivityStats>>;
  identities?: Partial<Record<CubeKey, { label?: string | null; url?: string | null }>>;
  meta?: { generatedAt?: string; snapshotDate?: string | null; live?: boolean };
};

export type CubeKey = "inrbadge" | "inr_search" | "site_inrcy" | "site_web" | "gmb" | "facebook" | "instagram" | "linkedin" | "mails" | "tiktok" | "youtube_shorts" | "pinterest";

export type Period = 7 | 14 | 30 | 60;

export type StatsTranslator = (
  key: string,
  values?: Record<string, string | number | boolean>,
) => string;

export type CapturedLeads = {
  week: number;
  month: number;
};

export type CubeState = {
  ov: Overview | null;
  loading: boolean;
  error?: string;
  capturedLeads?: CapturedLeads;
  connectionStatus?: "connected" | "needs_update" | "disconnected" | "unavailable";
};

export type StatsBulkResponse = {
  overviews?: Partial<Record<CubeKey, Overview>>;
  opportunities?: {
    total?: number;
    byCube?: Partial<Record<CubeKey, number>>;
  };
  profile?: {
    lead_conversion_rate?: number;
    avg_basket?: number;
  };
  estimatedByCube?: Partial<Record<CubeKey, number>>;
  capturedLeadsByCube?: {
    week?: Partial<Record<CubeKey, number>>;
    month?: Partial<Record<CubeKey, number>>;
  };
  blocks?: Partial<Record<CubeKey, InrstatsChannelBlock>>;
  meta?: { snapshotDate?: string | null; live?: boolean };
};

export type ChannelRefreshResponse = {
  periods?: Partial<Record<string, {
    block?: InrstatsChannelBlock;
    overview?: unknown;
    syncedAt?: number;
    snapshotDate?: string | null;
  }>>;
};

export type BulkFetchResult = {
  overviews: Partial<Record<CubeKey, Overview>>;
  summary: {
    total: number;
    byCube: Record<CubeKey, number>;
  };
  profile: {
    lead_conversion_rate: number;
    avg_basket: number;
  };
  estimatedByCube: Record<CubeKey, number>;
  blocks?: Partial<Record<CubeKey, InrstatsChannelBlock>>;
  snapshotDate: string | null;
};

export type ActionKey =
  | "booster_publier"
  | "propulser_action"
  | "fideliser_action"
  | "booster_avis"
  | "booster_promotion"
  | "fideliser_informer"
  | "fideliser_satisfaction"
  | "fideliser_remercier"
  | "mail_simple"
  | "connect"
  | "loading";

export type ActionEffort = {
  level: "faible" | "moyen" | "eleve";
  label: string;
};

export type CubeMetricItem = {
  label: string;
  value: string;
  subValue?: string;
};

export type InrcyActivityCount = {
  week: number;
  month: number;
  total: number;
};

export type InrcyActivityStats = {
  publications: InrcyActivityCount;
  photos: InrcyActivityCount;
  videos: InrcyActivityCount;
};

export type CubeModel = {
  inrcyOwnership?: "none" | "sold" | "rented";
  key: CubeKey;
  title: string;
  subtitle: string;
  accountLabel?: string;
  period: Period;
  loading: boolean;
  error?: string;
  connectionStatus?: "connected" | "needs_update" | "disconnected" | "unavailable";
  connections: {
    ga4?: boolean;
    gsc?: boolean;
    main?: boolean;
  };
  connectionPending?: boolean;
  provenance: Array<{ label: string; value: number; colorVar: string }>;
  opportunity30: number;
  opportunityLabel: string;
  capturedLeads: CapturedLeads;
  capturedLeadsUnavailable?: boolean;
  capturedLeadsHint?: string;
  provenanceHint?: string;
  visibilityStats: CubeMetricItem[];
  actionStats: CubeMetricItem[];
  inrcyActivityStats?: InrcyActivityStats | null;
  qualityScore: number;
  qualityLabel: string;
  qualityTone: "low" | "ok" | "solid" | "excellent";
  insights: string[];
  action: {
    key: ActionKey;
    title: string;
    detail: string;
    href: string;
    pill: string;
    effort?: ActionEffort;
    premiumLocked?: boolean;
  };
};
