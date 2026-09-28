import type { AdsChannelId } from "@/lib/adsValidation";

export type AdsConnectionSnapshot = {
  status: "unknown" | "connected" | "needs_update" | "disconnected";
  accountId: string;
  accountLabel: string;
  pageId: string;
};

export type AdsConnectionSnapshots = Record<AdsChannelId, AdsConnectionSnapshot>;

export const ADS_INTEGRATION_SOURCES: Record<AdsChannelId, string> = {
  meta: "meta_ads",
  google: "google_ads",
  linkedin: "linkedin_ads",
  tiktok: "tiktok_ads",
  pinterest: "pinterest_ads",
  x: "x_ads",
};

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
  status?: string | null;
  resource_id?: string | null;
  resource_label?: string | null;
  meta?: unknown;
} | null): AdsConnectionSnapshot {
  if (!row) return { ...unknownAdsConnection(), status: "disconnected" };
  const rawMeta = row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
    ? row.meta as Record<string, unknown> : {};
  const pageId = rawMeta.selected_page_id;
  return {
    status: row.status === "connected" ? "connected"
      : ["needs_update", "needs_reconnect", "expired", "error"].includes(row.status || "") ? "needs_update" : "disconnected",
    accountId: row.resource_id || "",
    accountLabel: row.resource_label || "",
    pageId: typeof pageId === "string" ? pageId : "",
  };
}

export function adsConnectionDisplay(snapshot: AdsConnectionSnapshot): { label: string; tone: string } {
  if (snapshot.status === "unknown") return { label: "Vérification…", tone: "loading" };
  if (snapshot.status === "needs_update") return { label: "Connexion à actualiser", tone: "select-account" };
  if (snapshot.status === "connected" && snapshot.accountId) return { label: "Compte connecté", tone: "connected" };
  if (snapshot.status === "connected") return { label: "Compte à associer", tone: "select-account" };
  return { label: "À connecter", tone: "disconnected" };
}
