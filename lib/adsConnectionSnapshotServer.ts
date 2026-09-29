import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  ADS_INTEGRATION_SOURCES,
  ADS_INTEGRATION_IDENTITIES,
  adsConnectionSnapshotFromRow,
  emptyAdsConnectionSnapshots,
  isAdsIntegrationForChannel,
  type AdsConnectionSnapshots,
} from "@/lib/adsConnectionSnapshot";
import type { AdsChannelId } from "@/lib/adsValidation";

/** One scoped read for the Ads cards, without provider calls or OAuth secrets. */
export async function readAdsConnectionSnapshots(userId: string): Promise<AdsConnectionSnapshots> {
  const snapshots = emptyAdsConnectionSnapshots();
  const { data, error } = await supabaseAdmin.from("integrations")
    .select("provider,source,product,status,expires_at,resource_id,resource_label,meta")
    .eq("user_id", userId)
    .eq("product", "ads")
    .in("source", Object.values(ADS_INTEGRATION_SOURCES))
    .in("provider", [...new Set(Object.values(ADS_INTEGRATION_IDENTITIES).map((identity) => identity.provider))]);
  if (error) return snapshots;
  for (const channel of Object.keys(ADS_INTEGRATION_SOURCES) as AdsChannelId[]) {
    const row = data?.find((integration) => isAdsIntegrationForChannel(integration, channel));
    snapshots[channel] = adsConnectionSnapshotFromRow(row || null);
  }
  return snapshots;
}
