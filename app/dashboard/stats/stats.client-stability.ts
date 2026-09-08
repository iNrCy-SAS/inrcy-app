export type StatsSnapshotMarker = {
  loading: boolean;
  syncedAt?: number | null;
};

export function hasCommittedStatsSnapshot(snapshot: StatsSnapshotMarker) {
  const syncedAt = Number(snapshot.syncedAt);
  return snapshot.loading === false && Number.isFinite(syncedAt) && syncedAt > 0;
}

export function formatStableStatsValue({
  ready,
  value,
  prefix = "",
  suffix = "",
}: {
  ready: boolean;
  value: string;
  prefix?: string;
  suffix?: string;
}) {
  return ready ? `${prefix}${value}${suffix}` : "—";
}

export function isLatestStatsRequest({
  requestSeq,
  latestRequestSeq,
  requestAccountScope,
  activeAccountScope,
}: {
  requestSeq: number;
  latestRequestSeq: number;
  requestAccountScope: string | null;
  activeAccountScope: string | null;
}) {
  return requestSeq === latestRequestSeq && requestAccountScope === activeAccountScope;
}
