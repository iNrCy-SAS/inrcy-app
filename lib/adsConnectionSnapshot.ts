import type { AdsChannelId } from "@/lib/adsValidation";

export type AdsConnectionSnapshot = {
  status: "unknown" | "connected" | "needs_update" | "disconnected";
  accountId: string;
  accountLabel: string;
  pageId: string;
  /** `false` means a provider refresh could not resolve the saved asset. */
  accountAvailable?: boolean;
  pageAvailable?: boolean;
};

export type AdsConnectionSnapshots = Record<AdsChannelId, AdsConnectionSnapshot>;

/** A saved association remains visible while its provider list refreshes.
 * This is display state only; publishing still verifies the account remotely. */
export function adsAssociationDisplayReady(connected: boolean, persistedId: string, selectedId: string, available?: boolean): boolean {
  return connected && Boolean(persistedId) && persistedId === selectedId && available !== false;
}

export type AdsIntegrationIdentity = {
  provider: string;
  source: string;
  product: "ads";
};

export const ADS_INTEGRATION_IDENTITIES: Record<AdsChannelId, AdsIntegrationIdentity> = {
  meta: { provider: "facebook", source: "meta_ads", product: "ads" },
  google: { provider: "google", source: "google_ads", product: "ads" },
  linkedin: { provider: "linkedin", source: "linkedin_ads", product: "ads" },
  tiktok: { provider: "tiktok", source: "tiktok_ads", product: "ads" },
  pinterest: { provider: "pinterest", source: "pinterest_ads", product: "ads" },
  x: { provider: "x", source: "x_ads", product: "ads" },
};

export const ADS_INTEGRATION_SOURCES = Object.fromEntries(
  Object.entries(ADS_INTEGRATION_IDENTITIES).map(([channel, identity]) => [channel, identity.source]),
) as Record<AdsChannelId, string>;

export function isAdsIntegrationForChannel(
  row: { provider?: unknown; source?: unknown; product?: unknown } | null | undefined,
  channel: AdsChannelId,
): boolean {
  if (!row) return false;
  const identity = ADS_INTEGRATION_IDENTITIES[channel];
  return row.provider === identity.provider
    && row.source === identity.source
    && row.product === identity.product;
}

export function unknownAdsConnection(): AdsConnectionSnapshot {
  return { status: "unknown", accountId: "", accountLabel: "", pageId: "" };
}

export function emptyAdsConnectionSnapshots(): AdsConnectionSnapshots {
  return {
    meta: unknownAdsConnection(), google: unknownAdsConnection(),
    linkedin: unknownAdsConnection(), tiktok: unknownAdsConnection(),
    pinterest: unknownAdsConnection(), x: unknownAdsConnection(),
  };
}

export function adsConnectionSnapshotFromRow(row: {
  source?: string | null;
  status?: string | null;
  expires_at?: string | null;
  resource_id?: string | null;
  resource_label?: string | null;
  meta?: unknown;
} | null, nowMs = Date.now()): AdsConnectionSnapshot {
  if (!row) return { ...unknownAdsConnection(), status: "disconnected" };
  const rawMeta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
    ? row.meta as Record<string, unknown> : {};
  const pageId = rawMeta.selected_page_id;
  const expiryMs = row.expires_at ? Date.parse(row.expires_at) : Number.NaN;
  const expiredMetaToken = row.source === "meta_ads"
    && row.status === "connected"
    && Number.isFinite(expiryMs)
    && expiryMs <= nowMs + 60_000;
  return {
    status: expiredMetaToken ? "needs_update" : row.status === "connected" ? "connected"
      : ["needs_update", "needs_reconnect", "expired", "error"].includes(row.status || "") ? "needs_update" : "disconnected",
    accountId: row.resource_id || "",
    accountLabel: row.resource_label || "",
    pageId: typeof pageId === "string" ? pageId : "",
  };
}

export function adsConnectionDisplay(snapshot: AdsConnectionSnapshot): { label: string; tone: string } {
  if (snapshot.status === "unknown") return { label: "Vérification…", tone: "loading" };
  if (snapshot.status === "needs_update") return { label: "Connexion à actualiser", tone: "select-account" };
  if (snapshot.status === "connected" && snapshot.accountId && snapshot.accountAvailable === false) {
    return { label: "Accès au compte à vérifier", tone: "select-account" };
  }
  if (snapshot.status === "connected" && snapshot.accountId) return { label: "Compte connecté", tone: "connected" };
  if (snapshot.status === "connected") return { label: "Compte à associer", tone: "select-account" };
  return { label: "À connecter", tone: "disconnected" };
}
