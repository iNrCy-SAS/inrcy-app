"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AdsCampaignTracking, { type StoredAdsCampaign } from "@/app/dashboard/ads/AdsCampaignTracking";

type AdsCampaignsResponse = {
  campaigns?: StoredAdsCampaign[];
  total?: number;
  nextOffset?: number | null;
  error?: string;
};

async function loadCampaignPage(offset = 0): Promise<AdsCampaignsResponse> {
  const response = await fetch(`/api/ads/campaigns?offset=${offset}`, { cache: "no-store" });
  const result = await response.json().catch(() => null) as AdsCampaignsResponse | null;
  if (!response.ok) throw new Error(result?.error || "Impossible de charger les campagnes Ads.");
  return result || {};
}

export default function AdsCampaignsFolder({ onCountChange }: { onCountChange: (count: number) => void }) {
  const router = useRouter();
  const mounted = useRef(true);
  const [campaigns, setCampaigns] = useState<StoredAdsCampaign[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await loadCampaignPage();
      if (!mounted.current) return;
      const loaded = Array.isArray(result.campaigns) ? result.campaigns : [];
      const count = typeof result.total === "number" ? result.total : loaded.length;
      setCampaigns(loaded);
      setTotal(count);
      setNextOffset(typeof result.nextOffset === "number" ? result.nextOffset : null);
      onCountChange(count);
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : "Campagnes indisponibles.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  async function loadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setLoadError("");
    try {
      const result = await loadCampaignPage(nextOffset);
      if (!mounted.current) return;
      const loaded = Array.isArray(result.campaigns) ? result.campaigns : [];
      setCampaigns((current) => {
        const known = new Set(current.map((campaign) => campaign.id));
        return [...current, ...loaded.filter((campaign) => !known.has(campaign.id))];
      });
      const count = typeof result.total === "number" ? result.total : total;
      setTotal(count);
      setNextOffset(typeof result.nextOffset === "number" ? result.nextOffset : null);
      onCountChange(count);
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : "Campagnes suivantes indisponibles.");
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }

  return <AdsCampaignTracking
    presentation="inrsend"
    campaigns={campaigns}
    total={total}
    loading={loading}
    loadingMore={loadingMore}
    hasMore={nextOffset !== null}
    loadError={loadError}
    onRefresh={refresh}
    onLoadMore={loadMore}
    onClose={() => router.push("/dashboard/ads")}
    onEdit={(campaign) => router.push(`/dashboard/ads?editCampaign=${encodeURIComponent(campaign.id)}`)}
  />;
}
