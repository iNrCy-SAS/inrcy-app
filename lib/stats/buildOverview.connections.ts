import "server-only";

import {
  INRCY_PUBLISHABLE_CHANNELS,
  asRecord,
} from "@/lib/stats/buildOverview.shared";
import type { InrcyActivityStatsByChannel } from "@/lib/stats/buildOverview.shared";
import { INRCY_STATS_CACHE_SCHEMA_VERSION } from "@/lib/stats/cacheSchema";

export async function buildOverviewConnectionsKey({
  integrationsAll,
  inrcySettings,
  proSettings,
  inrcySiteOwnership,
  inrcySiteUrl,
  inrcyTrackingEnabled,
  sectorCategory,
  profession,
  inrcyPublishedActivityStats,
}: {
  integrationsAll: unknown;
  inrcySettings: unknown;
  proSettings: unknown;
  inrcySiteOwnership: string;
  inrcySiteUrl: unknown;
  inrcyTrackingEnabled: boolean;
  sectorCategory: string;
  profession: string;
  inrcyPublishedActivityStats: InrcyActivityStatsByChannel;
}) {
  const keyParts: string[] = [
    `cache_schema:${INRCY_STATS_CACHE_SCHEMA_VERSION}`,
  ];

  try {
    const rows = Array.isArray(integrationsAll)
      ? (integrationsAll as unknown[])
      : [];
    for (const r of rows) {
      const rr = asRecord(r);
      const provider = String(rr["provider"] ?? "");
      const source = String(rr["source"] ?? "");
      const product = String(rr["product"] ?? "");
      const status = String(rr["status"] ?? "");
      const resource = String(rr["resource_id"] ?? "");
      const updated = String(rr["updated_at"] ?? rr["created_at"] ?? "");
      if (!provider || !source || !product) continue;
      keyParts.push(
        `${provider}:${source}:${product}:${status}:${resource}:${updated}`,
      );
    }
  } catch {}

  try {
    const inrcyGa4Cfg = asRecord(asRecord(inrcySettings)["ga4"]);
    const inrcyGscCfg = asRecord(asRecord(inrcySettings)["gsc"]);
    const proSiteWebCfg = asRecord(asRecord(proSettings)["site_web"]);
    const webGa4Cfg = asRecord(proSiteWebCfg["ga4"]);
    const webGscCfg = asRecord(proSiteWebCfg["gsc"]);
    keyParts.push(`profile:ownership=${inrcySiteOwnership}`);
    keyParts.push(`inrcy:site_url=${String(inrcySiteUrl ?? "")}`);
    keyParts.push(
      `inrcy:ga4:${String(inrcyGa4Cfg["property_id"] ?? "")}:${String(inrcyGa4Cfg["measurement_id"] ?? "")}`,
    );
    keyParts.push(`inrcy:gsc:${String(inrcyGscCfg["property"] ?? "")}`);
    keyParts.push(
      `site_web:ga4:${String(webGa4Cfg["property_id"] ?? "")}:${String(webGa4Cfg["measurement_id"] ?? "")}`,
    );
    keyParts.push(`site_web:gsc:${String(webGscCfg["property"] ?? "")}`);
  } catch {}

  keyParts.push(`inrcyTrackingEnabled:${inrcyTrackingEnabled ? "1" : "0"}`);
  keyParts.push(`business:sector=${sectorCategory}:profession=${profession}`);
  keyParts.push("statsVersion:inrcyPublishedActivityV1");
  keyParts.push(
    `inrcyActivity:${INRCY_PUBLISHABLE_CHANNELS.map((channel) => {
      const stats = inrcyPublishedActivityStats[channel];
      return [
        channel,
        stats?.publications.week || 0,
        stats?.publications.month || 0,
        stats?.publications.total || 0,
        stats?.photoPosts.week || 0,
        stats?.photoPosts.month || 0,
        stats?.photoPosts.total || 0,
        stats?.photos.week || 0,
        stats?.photos.month || 0,
        stats?.photos.total || 0,
        stats?.videos.week || 0,
        stats?.videos.month || 0,
        stats?.videos.total || 0,
        stats?.latestAt || "none",
      ].join(":");
    }).join("|")}`,
  );

  return keyParts.join("|") || "none";
}
